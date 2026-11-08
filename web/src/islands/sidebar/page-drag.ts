// Pages list drag & drop: reorder pages by dragging rows (Wonder L2: a 2px purple insertion line across the panel and a
// small floating chip with the page name). Pointer-driven like layer-drag.ts; React re-renders only when the insertion
// point changes. The document change is one validated `setDocument` call, so it is a single undo step and reaches cloud
// rooms as a `pageOrder` operation (web/cloud-ops.js).
import {
  useCallback,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { design, portalContainer } from "@/lib/bridge";

const DRAG_THRESHOLD = 4;

/** Insertion point: `index` in the current order (0 = before the first page); `top` is relative to the list. */
export type PageDrop = { index: number; top: number };

let suppressClick = false;
/** True while the click that ends a drag is being dispatched (rows ignore it). */
export const pageDragJustEnded = () => suppressClick;

/** Move page `id` so it lands before the page currently at `index`. One undo step; selection and active page kept. */
export function movePage(id: string, index: number): boolean {
  const api = design();
  const doc = api.getDocument();
  const from = doc.pages.findIndex((p) => p.id === id);
  if (from < 0) return false;
  const to = index > from ? index - 1 : index;
  if (to === from) return false;
  const [page] = doc.pages.splice(from, 1);
  doc.pages.splice(to, 0, page);
  const selection = api.getSelection();
  api.setDocument(doc);
  if (selection.length) api.setSelection(selection);
  return true;
}

function ghostFor(row: HTMLElement): HTMLElement {
  const ghost = document.createElement("div");
  ghost.id = "bd-page-drag-ghost";
  ghost.setAttribute("aria-hidden", "true");
  ghost.className =
    "pointer-events-none fixed top-0 left-0 z-50 flex h-7.5 items-center gap-2 rounded-lg border border-edge bg-popover px-2.5 text-xs text-foreground shadow-md";
  const icon = row.querySelector("svg")?.cloneNode(true);
  if (icon) ghost.append(icon);
  const label = document.createElement("span");
  label.textContent = row.dataset.pageName ?? row.textContent ?? "";
  ghost.append(label);
  return ghost;
}

export function usePageDrag(listRef: RefObject<HTMLElement | null>) {
  const [drop, setDrop] = useState<PageDrop | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const current = useRef<PageDrop | null>(null);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, id: string) => {
      if (event.button !== 0) return;
      if ((event.target as Element).closest("input, textarea, select")) return;
      const start = { x: event.clientX, y: event.clientY };
      const row = event.currentTarget;
      let active = false;
      let ghost: HTMLElement | null = null;
      current.current = null;

      const rows = () =>
        Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-page-id]") ?? []);
      const targetAt = (clientY: number): PageDrop | null => {
        const list = listRef.current;
        const all = rows();
        if (!list || all.length < 2) return null;
        const base = list.getBoundingClientRect();
        let index = all.findIndex((r) => {
          const b = r.getBoundingClientRect();
          return clientY < b.top + b.height / 2;
        });
        if (index < 0) index = all.length;
        const from = all.findIndex((r) => r.dataset.pageId === id);
        if (index === from || index === from + 1) return null;
        const top =
          index < all.length
            ? all[index].getBoundingClientRect().top - base.top
            : all[all.length - 1].getBoundingClientRect().bottom - base.top;
        return { index, top };
      };

      const finish = (commit: boolean) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", key, true);
        if (!active) return;
        ghost?.remove();
        delete document.body.dataset.pageDrag;
        suppressClick = true;
        setTimeout(() => {
          suppressClick = false;
        });
        const target = current.current;
        current.current = null;
        setDrop(null);
        setDragging(null);
        if (commit && target) movePage(id, target.index);
      };
      const move = (e: PointerEvent) => {
        if (!active) {
          if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD) return;
          active = true;
          ghost = ghostFor(row);
          portalContainer().append(ghost);
          document.body.dataset.pageDrag = "true";
          setDragging(id);
        }
        if (ghost) ghost.style.transform = `translate(${e.clientX + 8}px, ${e.clientY - 15}px)`;
        const next = targetAt(e.clientY);
        if (next?.index !== current.current?.index || next?.top !== current.current?.top) {
          current.current = next;
          setDrop(next);
        }
      };
      const up = () => finish(true);
      const cancel = () => finish(false);
      const key = (e: KeyboardEvent) => {
        if (e.key !== "Escape" || !active) return;
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("keydown", key, true);
    },
    [listRef],
  );

  return { drop, dragging, onPointerDown };
}
