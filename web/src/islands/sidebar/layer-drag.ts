// Layers tree drag & drop: reorder siblings and re-parent into/out of frames by dragging rows.
// Pointer-driven (not HTML5 DnD) so the drop indicator is exact and the gesture is cancellable with Escape.
// The document change itself is one call to `window.design.moveNodes` (validated, one undo step, world
// positions kept); this hook only tracks the pointer and the indicator. React re-renders only when the drop
// target changes, never per pointer move.
import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { design } from "@/lib/bridge";
import type { TreeNode } from "./hooks";

export type DropPosition = "above" | "below" | "inside";
/** Indicator geometry is relative to the rows container. */
export type Drop = { id: string; position: DropPosition; top: number; height: number; indent: number };

type MoveNodes = (ids: string[], targetId: string | null, position: DropPosition) => string[] | null;

const DRAG_THRESHOLD = 4;
const EDGE_SCROLL = 24;

/** True while the click that ends a drag is being dispatched (rows ignore it). */
let suppressClick = false;
export const dragJustEnded = () => suppressClick;

function descendantsOf(ids: string[], nodes: TreeNode[]): Set<string> {
  const out = new Set(ids);
  let size = 0;
  while (size !== out.size) {
    size = out.size;
    for (const n of nodes) if (n.parentId && out.has(n.parentId)) out.add(n.id);
  }
  return out;
}

/**
 * `listRef` is the element that contains the `.layer-row` elements (the indicator is positioned inside it);
 * `scrollRef` scrolls. `nodes` is the current tree (flat, document order).
 */
export function useLayerDrag({
  listRef,
  scrollRef,
  nodes,
  onExpand,
}: {
  listRef: RefObject<HTMLElement | null>;
  scrollRef: RefObject<HTMLElement | null>;
  nodes: TreeNode[];
  onExpand: (id: string) => void;
}) {
  const [drop, setDrop] = useState<Drop | null>(null);
  const [dragging, setDragging] = useState<string[]>([]);
  const nodesRef = useRef(nodes);
  const onExpandRef = useRef(onExpand);
  // Read only from pointer handlers, so they are synced once the render commits.
  useLayoutEffect(() => {
    nodesRef.current = nodes;
    onExpandRef.current = onExpand;
  });

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, id: string) => {
      if (event.button !== 0 || event.altKey) return;
      if ((event.target as Element).closest("button, input, textarea, select")) return;
      const start = { x: event.clientX, y: event.clientY };
      let ids: string[] | null = null;
      let excluded = new Set<string>();
      let current: Drop | null = null;

      const targetAt = (clientY: number): Drop | null => {
        const list = listRef.current;
        if (!list || !ids) return null;
        const rows = Array.from(list.querySelectorAll<HTMLElement>(".layer-row"));
        if (!rows.length) return null;
        const base = list.getBoundingClientRect();
        const byId = new Map(nodesRef.current.map((n) => [n.id, n]));
        let row = rows.find((r) => {
          const b = r.getBoundingClientRect();
          return clientY >= b.top && clientY < b.bottom;
        });
        let rel = 0.5;
        let end = false;
        if (row) {
          const b = row.getBoundingClientRect();
          rel = (clientY - b.top) / b.height;
        } else if (clientY < rows[0].getBoundingClientRect().top) {
          row = rows[0];
          rel = 0;
        } else {
          // Below the last row: behind everything at the page root.
          row = rows.filter((r) => byId.get(r.dataset.id ?? "")?.parentId == null).pop() ?? rows[rows.length - 1];
          end = true;
        }
        const target = byId.get(row.dataset.id ?? "");
        if (!target || excluded.has(target.id)) return null;
        const expandedWithChildren =
          row.getAttribute("aria-expanded") === "true" && nodesRef.current.some((n) => n.parentId === target.id);
        let position: DropPosition;
        if (end) position = "below";
        else if (target.type === "frame") position = rel < 0.25 ? "above" : rel > 0.75 && !expandedWithChildren ? "below" : "inside";
        else position = rel < 0.5 ? "above" : "below";
        const parent = position === "inside" ? target : target.parentId ? byId.get(target.parentId) : undefined;
        if (parent?.locked) return null;
        const b = row.getBoundingClientRect();
        const depth = Number(row.style.getPropertyValue("--layer-depth")) || 0;
        // Past the end of the list the line sits under the last row (which may be a child of the target).
        const top = end ? rows[rows.length - 1].getBoundingClientRect().bottom - base.top : b.top - base.top + (position === "below" ? b.height : 0);
        return { id: target.id, position, top, height: position === "inside" ? b.height : 0, indent: depth + (position === "inside" ? 1 : 0) };
      };

      const begin = () => {
        const selection = design().getSelection();
        const chosen = selection.includes(id) ? selection : [id];
        if (!selection.includes(id)) design().setSelection([id]);
        const byId = new Map(nodesRef.current.map((n) => [n.id, n]));
        const movable = chosen.filter((x) => byId.has(x) && !byId.get(x)?.locked);
        if (!movable.length) return false;
        ids = movable;
        excluded = descendantsOf(movable, nodesRef.current);
        setDragging(movable);
        document.body.dataset.layerDrag = "true";
        return true;
      };

      const finish = (commit: boolean) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", key, true);
        if (!ids) return;
        delete document.body.dataset.layerDrag;
        suppressClick = true;
        setTimeout(() => {
          suppressClick = false;
        });
        const target = current;
        setDrop(null);
        setDragging([]);
        if (!commit || !target) return;
        const moveNodes = design().moveNodes as MoveNodes | undefined;
        const moved = moveNodes?.(ids, target.id, target.position);
        if (moved && target.position === "inside") onExpandRef.current(target.id);
      };
      const move = (e: PointerEvent) => {
        if (!ids) {
          if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD) return;
          if (!begin()) {
            finish(false);
            return;
          }
        }
        const scroller = scrollRef.current;
        if (scroller) {
          const b = scroller.getBoundingClientRect();
          if (e.clientY < b.top + EDGE_SCROLL) scroller.scrollTop -= 8;
          else if (e.clientY > b.bottom - EDGE_SCROLL) scroller.scrollTop += 8;
        }
        const next = targetAt(e.clientY);
        if (
          next?.id !== current?.id ||
          next?.position !== current?.position ||
          next?.top !== current?.top
        ) {
          current = next;
          setDrop(next);
        }
      };
      const up = () => finish(true);
      const cancel = () => finish(false);
      const key = (e: KeyboardEvent) => {
        if (e.key !== "Escape" || !ids) return;
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("keydown", key, true);
    },
    [listRef, scrollRef],
  );

  return { drop, dragging, onPointerDown };
}
