// "Layers" section: search, collapse-all and the layer tree of the active page. Rows can be dragged to reorder
// siblings or move layers into / out of frames (see layer-drag.ts).
// Rows keep the legacy test contract: `.layer-row` (+ `.active`, `.is-hidden`, `.is-locked`) with
// `[data-toggle=locked|hidden]` buttons inside.
import {
  memo,
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { ChevronRight, Eye, EyeOff, ListChevronsDownUp, Lock, Search, Type } from "lucide-react";
import { design, useSelection } from "@/lib/bridge";
import { LayerRowMenu, RowMenuRoot, RowMenuTrigger } from "../context-menu/RowMenus";
import { cn } from "@/lib/utils";
import { Hint, IconButton, InlineRename, SectionHeader } from "./parts";
import { LayerTypeIcon } from "./icons";
import { useTakeOver } from "./legacy";
import { contract } from "./contract";
import { applyLayerPreview, useLayerPreview, useTreeNodes, type TreeNode } from "./hooks";
import { dragJustEnded, useLayerDrag, type Drop } from "./layer-drag";

type Row = { node: TreeNode; depth: number; hasChildren: boolean; expanded: boolean };

/** Same order as legacy `rows()` in app.js: siblings top-most first (reverse paint order), depth-first. */
function buildRows(nodes: TreeNode[], expanded: Set<string>, query: string): Row[] {
  const children = new Map<string | null, TreeNode[]>();
  for (const n of nodes) {
    const key = n.parentId || null;
    const list = children.get(key);
    if (list) list.push(n);
    else children.set(key, [n]);
  }
  const rows: Row[] = [];
  const q = query.trim().toLowerCase();
  const walk = (parent: string | null, depth: number) => {
    const list = children.get(parent);
    if (!list) return;
    for (let i = list.length - 1; i >= 0; i--) {
      const node = list[i];
      const hasChildren = children.has(node.id);
      const open = q ? true : expanded.has(node.id);
      if (!q || node.name.toLowerCase().includes(q))
        rows.push({ node, depth, hasChildren, expanded: open });
      if (hasChildren && open) walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

function ancestorsOf(ids: string[], nodes: TreeNode[]): string[] {
  const parent = new Map(nodes.map((n) => [n.id, n.parentId || null]));
  const out = new Set<string>();
  for (const id of ids) {
    let p = parent.get(id) ?? null;
    while (p && !out.has(p)) {
      out.add(p);
      p = parent.get(p) ?? null;
    }
  }
  return [...out];
}

function toggleFlag(node: TreeNode, key: "locked" | "hidden") {
  design().updateNodes([node.id], { [key]: node[key] ? undefined : true });
}

function select(id: string, event: MouseEvent | KeyboardEvent) {
  const current = design().getSelection();
  if (event.shiftKey || event.metaKey || event.ctrlKey) {
    design().setSelection(
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  } else if (current.length !== 1 || current[0] !== id) {
    design().setSelection([id]);
  }
}

type RowProps = {
  row: Row;
  selected: boolean;
  focusable: boolean;
  renaming: boolean;
  dragging: boolean;
  onToggleExpand: (id: string) => void;
  onRename: (id: string | null) => void;
  onDragStart: (event: PointerEvent<HTMLElement>, id: string) => void;
};

const LayerRow = memo(function LayerRow({
  row,
  selected,
  focusable,
  renaming,
  dragging,
  onToggleExpand,
  onRename,
  onDragStart,
}: RowProps) {
  const { node, depth, hasChildren, expanded } = row;
  const action = cn(
    "hidden size-6 shrink-0 items-center justify-center rounded-md bg-transparent group-hover:flex group-focus-within:flex hover:bg-foreground/10 hover:text-foreground",
    selected ? "text-foreground-2/85" : "text-foreground-3",
  );
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const rows = Array.from(
      e.currentTarget.parentElement?.querySelectorAll<HTMLElement>(".layer-row") ?? [],
    );
    const index = rows.indexOf(e.currentTarget);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      rows[index + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      e.stopPropagation();
      if (hasChildren && expanded !== (e.key === "ArrowRight")) onToggleExpand(node.id);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      select(node.id, e);
    } else if (e.key === "F2") {
      e.preventDefault();
      onRename(node.id);
    }
  };

  return (
    <RowMenuRoot>
      <RowMenuTrigger asChild>
        <div
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={selected}
          aria-expanded={hasChildren ? expanded : undefined}
          tabIndex={focusable ? 0 : -1}
          data-id={node.id}
          data-role={node.role}
          className={cn(
            contract(
              "layer-row",
              selected && "active",
              node.hidden && "is-hidden",
              node.locked && "is-locked",
            ),
            "group relative m-0 flex h-7.5 w-full shrink-0 items-center rounded-md border-0 bg-transparent py-0 pr-2 text-xs text-foreground-2 hover:bg-muted",
            selected && "bg-selection hover:bg-selection",
            dragging && "opacity-50",
          )}
          style={{ "--layer-depth": depth } as CSSProperties}
          onPointerDown={renaming ? undefined : (e) => onDragStart(e, node.id)}
          onClick={(e) => {
            if (!dragJustEnded()) select(node.id, e);
          }}
          onDoubleClick={() => onRename(node.id)}
          onContextMenu={() => {
            // Wonder CM7: the row menu acts on this layer; a multi-selection that contains it is kept.
            if (!selected) design().setSelection([node.id]);
          }}
          onKeyDown={onKeyDown}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-label={expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
            className={cn(
              "flex size-4 shrink-0 items-center justify-center bg-transparent hover:text-foreground",
              selected ? "text-foreground" : "text-muted-foreground",
              !hasChildren && "invisible",
            )}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.id);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <ChevronRight
              className={cn("size-3 transition-transform duration-150", expanded && "rotate-90")}
            />
          </button>
          <LayerTypeIcon
            node={node}
            className={cn(
              "ml-1 size-4 shrink-0",
              selected ? "text-foreground" : "text-muted-foreground",
              (node.role === "main" || node.role === "instance") && "text-component",
              node.role === "slot" && "text-slot",
              node.hidden && "opacity-50",
            )}
          />
          <div
            className={cn(
              "ml-2.25 flex min-w-0 flex-1 items-center",
              (node.role === "main" || node.role === "instance") && "text-component-foreground",
              node.role === "slot" && "text-slot-foreground",
              node.role === "inherited" && "text-component-muted",
              node.hidden && "opacity-50",
            )}
          >
            {renaming ? (
              <InlineRename
                value={node.name}
                label="Layer name"
                className="-ml-1.5"
                onCommit={(name) => design().updateNodes([node.id], { name })}
                onDone={() => onRename(null)}
              />
            ) : (
              <span className="truncate select-none">{node.name}</span>
            )}
          </div>
          {!renaming && (
            <div className="ml-1 flex shrink-0 items-center gap-1">
              <Hint label="Rename layer">
                <button
                  type="button"
                  aria-label={`Rename ${node.name}`}
                  className={action}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRename(node.id);
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  <Type className="size-4" />
                </button>
              </Hint>
              <Hint label={node.locked ? "Unlock layer" : "Lock layer"}>
                <button
                  type="button"
                  data-toggle="locked"
                  aria-pressed={Boolean(node.locked)}
                  aria-label={`${node.locked ? "Unlock" : "Lock"} ${node.name}`}
                  className={cn(
                    contract(node.locked && "on"),
                    action,
                    node.locked && "flex text-foreground",
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFlag(node, "locked");
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  <Lock className="size-4" />
                </button>
              </Hint>
              <Hint label={node.hidden ? "Show layer" : "Hide layer"}>
                <button
                  type="button"
                  data-toggle="hidden"
                  aria-pressed={Boolean(node.hidden)}
                  aria-label={`${node.hidden ? "Show" : "Hide"} ${node.name}`}
                  className={cn(
                    contract(node.hidden && "on"),
                    action,
                    node.hidden && "flex text-foreground",
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFlag(node, "hidden");
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  {node.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </Hint>
            </div>
          )}
        </div>
      </RowMenuTrigger>
      <LayerRowMenu />
    </RowMenuRoot>
  );
});

export function LayersSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const nodes = useTreeNodes();
  const selection = useSelection();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useTakeOver("layer-search", searchRef);
  const { drop, dragging, onPointerDown } = useLayerDrag({
    listRef,
    scrollRef: treeRef,
    nodes,
    onExpand: (id) => setExpanded((prev) => (prev.has(id) ? prev : new Set([...prev, id]))),
  });
  const draggingSet = useMemo(() => new Set(dragging), [dragging]);

  // Reveal layers selected on the canvas: expand their ancestors and scroll them into view.
  const selectionKey = selection.join(",");
  useEffect(() => {
    if (!selectionKey) return;
    const ids = selectionKey.split(",");
    const parents = ancestorsOf(ids, nodes);
    if (parents.length) {
      setExpanded((prev) =>
        parents.every((p) => prev.has(p)) ? prev : new Set([...prev, ...parents]),
      );
    }
    requestAnimationFrame(() => {
      const row = treeRef.current?.querySelector(`[data-id="${CSS.escape(ids[ids.length - 1])}"]`);
      row?.scrollIntoView({ block: "nearest" });
    });
    // Only when the selection changes, not on every document edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  // A canvas drag that will re-parent on release shows its layers at the new place while the pointer is held.
  const preview = useLayerPreview();
  const shown = useMemo(() => applyLayerPreview(nodes, preview), [nodes, preview]);
  const rows = useMemo(() => buildRows(shown, expanded, query), [shown, expanded, query]);
  const selected = useMemo(() => new Set(selection), [selection]);

  const toggleExpand = useMemo(
    () => (id: string) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );

  const closeSearch = () => {
    setSearching(false);
    setQuery("");
  };

  return (
    <section aria-label="Layers" className="flex min-h-0 flex-1 flex-col">
      <SectionHeader
        title="Layers"
        open={open}
        onToggle={onToggle}
        controls="bd-layer-tree"
        className="-mt-px"
      >
        <IconButton
          label="Collapse all"
          disabled={expanded.size === 0 || Boolean(query)}
          onClick={() => setExpanded(new Set())}
        >
          <ListChevronsDownUp className="size-4" />
        </IconButton>
        <IconButton
          label="Search layers"
          aria-pressed={searching}
          className={cn(searching && "bg-muted text-foreground")}
          onClick={() => {
            if (searching) closeSearch();
            else {
              setSearching(true);
              if (!open) onToggle();
              requestAnimationFrame(() => searchRef.current?.focus());
            }
          }}
        >
          <Search className="size-4" />
        </IconButton>
      </SectionHeader>
      <div className={cn("shrink-0 px-1.5 pb-1.5", (!searching || !open) && "hidden")}>
        <div className="flex h-7 items-center gap-2 rounded-md bg-input px-2 text-muted-foreground focus-within:outline focus-within:outline-1 focus-within:outline-ring">
          <Search className="size-3.5 shrink-0" />
          <input
            ref={searchRef}
            type="search"
            placeholder="Search layers"
            aria-label="Find layer"
            value={query}
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent text-xs text-foreground"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") closeSearch();
            }}
          />
        </div>
      </div>
      <div
        id="bd-layer-tree"
        ref={treeRef}
        role="tree"
        aria-label="Layers"
        aria-multiselectable="true"
        hidden={!open}
        className="min-h-0 flex-1 overflow-y-auto px-1.5 pt-1 pb-3"
      >
        <div ref={listRef} className="relative flex flex-col gap-0.5">
          {rows.map((row, index) => (
            <LayerRow
              key={row.node.id}
              row={row}
              selected={selected.has(row.node.id)}
              focusable={selected.size ? selected.has(row.node.id) : index === 0}
              renaming={renaming === row.node.id}
              dragging={draggingSet.has(row.node.id)}
              onToggleExpand={toggleExpand}
              onRename={setRenaming}
              onDragStart={onPointerDown}
            />
          ))}
          {drop && <DropIndicator drop={drop} />}
        </div>
        {rows.length === 0 && (
          <p className="px-3 py-2 text-xs text-subtle-foreground">
            {query ? "No matching layers" : "No layers on this page"}
          </p>
        )}
      </div>
    </section>
  );
}

/** Insertion line (above/below a row, indented to the drop depth) or an outline around the frame row for `inside`. */
function DropIndicator({ drop }: { drop: Drop }) {
  const inside = drop.position === "inside";
  return (
    <div
      id="bd-layer-drop-indicator"
      aria-hidden="true"
      data-target={drop.id}
      data-position={drop.position}
      className={cn(
        "pointer-events-none absolute right-0 z-10",
        inside
          ? "left-0 rounded-md border border-primary"
          : "h-0.5 -translate-y-1/2 rounded-full bg-primary",
      )}
      style={
        {
          "--drop-top": `${drop.top}px`,
          "--drop-height": `${drop.height}px`,
          "--drop-depth": drop.indent,
        } as CSSProperties
      }
    />
  );
}
