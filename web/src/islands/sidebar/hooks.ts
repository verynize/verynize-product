// Narrow subscriptions to the legacy design store. The store notifies after *every* legacy render
// (including each pointer move while dragging on the canvas); the sidebar only re-renders when the
// slice it shows actually changes.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { activePage, design, type DesignDocument, type LayerNode } from "@/lib/bridge";
import { layerRole, type LayerRole } from "@/lib/components";

/** Subscribe to a JSON-serialisable slice of the document; re-renders only when the slice changes. */
export function useDesignSlice<T>(select: (doc: DesignDocument) => T): T {
  const selectRef = useRef(select);
  // The store notifies after commit, so the selector only needs to be current once this render commits.
  useLayoutEffect(() => {
    selectRef.current = select;
  });
  const keyRef = useRef<string | null>(null);
  const subscribe = useCallback((notify: () => void) => {
    const api = design();
    if (!api) return () => {};
    return api.subscribe((doc) => {
      const next = JSON.stringify(selectRef.current(doc));
      if (next !== keyRef.current) {
        keyRef.current = next;
        notify();
      }
    });
  }, []);
  const key = useSyncExternalStore(subscribe, () => {
    if (keyRef.current === null) keyRef.current = JSON.stringify(selectRef.current(design().getDocument()));
    return keyRef.current;
  });
  return useMemo(() => JSON.parse(key) as T, [key]);
}

export type PageInfo = { id: string; name: string };
export type DocSummary = { name: string; activePage: string; pages: PageInfo[] };

export function useDocSummary(): DocSummary {
  return useDesignSlice((doc) => ({
    name: doc.name,
    activePage: activePage(doc)?.id ?? doc.activePage,
    pages: doc.pages.map((p) => ({ id: p.id, name: p.name })),
  }));
}

/** Only the fields the layer tree renders. */
export type TreeNode = Pick<LayerNode, "id" | "name" | "type" | "parentId" | "hidden" | "locked"> & {
  layout?: string;
  direction?: string;
  ellipse?: boolean;
  /** A live preview frame (preview audit PF7): drawn with a browser-window icon. */
  preview?: true;
  /** Main component, instance root, slot or inherited instance layer (design/component-audit "Layers panel"). */
  role?: Exclude<LayerRole, null>;
};

export function useTreeNodes(): TreeNode[] {
  return useDesignSlice((doc) =>
    (activePage(doc)?.nodes ?? []).map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      parentId: n.parentId ?? null,
      hidden: n.hidden || undefined,
      locked: n.locked || undefined,
      layout: typeof n.layout === "string" ? n.layout : undefined,
      direction: typeof n.direction === "string" ? n.direction : undefined,
      ellipse: n.ellipse === true || undefined,
      preview: n.preview ? (true as const) : undefined,
      role: layerRole(n) ?? undefined,
    })),
  );
}

/** A canvas drag's pending re-parent (`bd:layer-preview` from canvas-interactions.js); null when none. */
export type LayerPreview = { ids: string[]; parentId: string | null; index?: number } | null;

/** The live hierarchy preview of a canvas drag (Wonder R1-row-drag-out/-far): view state only, never the document. */
export function useLayerPreview(): LayerPreview {
  const [preview, setPreview] = useState<LayerPreview>(null);
  useEffect(() => {
    const on = (event: Event) => setPreview((event as CustomEvent<LayerPreview>).detail ?? null);
    window.addEventListener("bd:layer-preview", on);
    return () => window.removeEventListener("bd:layer-preview", on);
  }, []);
  return preview;
}

/** Tree nodes as they will be after the previewed drop: moved under the new parent at the slot release would use
 * (the same placement as `relocate` in canvas-interactions.js; top-most when no stack slot applies). */
export function applyLayerPreview(nodes: TreeNode[], preview: LayerPreview): TreeNode[] {
  if (!preview) return nodes;
  const ids = new Set(preview.ids);
  const moved = nodes.filter((n) => ids.has(n.id)).map((n) => ({ ...n, parentId: preview.parentId }));
  if (!moved.length) return nodes;
  const rest = nodes.filter((n) => !ids.has(n.id));
  const siblings = rest.filter((n) => (n.parentId || null) === preview.parentId);
  const index = preview.index;
  const at =
    index !== undefined && index < siblings.length
      ? rest.indexOf(siblings[index])
      : siblings.length
        ? rest.indexOf(siblings[siblings.length - 1]) + 1
        : rest.length;
  return [...rest.slice(0, at), ...moved, ...rest.slice(at)];
}
