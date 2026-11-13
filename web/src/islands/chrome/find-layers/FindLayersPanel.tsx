import { useEffect, useMemo, useRef, useState } from "react";
import { Search, SearchX, X, Type, Square, Frame, Image, Sparkles } from "lucide-react";
import { activePage, design, useDesign, type DesignDocument } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import { paletteKeyAllowed } from "../CommandPalette";
import { setPanelOpen, usePanelOpen } from "../shortcuts";
import { buildIndex, search } from "./search";
import { spotlightResult } from "./spotlight";

let lastQuery = "";
let lastActiveId: string | null = null;
const close = () => setPanelOpen("find", false);
// Use rendered bounds so nested, rotated and auto-layout layers are framed correctly.
function frameResult(id: string, panel: HTMLDivElement | null) {
  const node = document.querySelector(`#canvas [data-id="${CSS.escape(id)}"]`);
  const viewport = document.getElementById("canvas-wrap")?.getBoundingClientRect();
  const bounds = node?.getBoundingClientRect();
  if (!viewport || !bounds || (!bounds.width && !bounds.height)) return;
  const camera = design().getCamera();
  const x = (bounds.left - viewport.left - camera.x) / camera.zoom;
  const y = (bounds.top - viewport.top - camera.y) / camera.zoom;
  const width = bounds.width / camera.zoom;
  const height = bounds.height / camera.zoom;
  // Reserve the finder on the right and the floating toolbar along the bottom.
  const right = Math.min(viewport.right, panel?.getBoundingClientRect().left ?? viewport.right);
  const availableWidth = Math.max(40, right - viewport.left - 64);
  const availableHeight = Math.max(40, viewport.height - 128);
  const zoom = Math.max(
    0.02,
    Math.min(1, availableWidth / Math.max(1, width), availableHeight / Math.max(1, height)),
  );
  design().setCamera(
    32 + (availableWidth - width * zoom) / 2 - x * zoom,
    48 + (availableHeight - height * zoom) / 2 - y * zoom,
    zoom,
  );
}
function slice(doc: DesignDocument) {
  return {
    page: doc.activePage,
    nodes: (activePage(doc)?.nodes ?? []).map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      parentId: n.parentId,
      hidden: n.hidden,
      locked: n.locked,
      text: typeof n.text === "string" ? n.text : undefined,
      shortId: typeof n.shortId === "string" ? n.shortId : undefined,
    })),
  };
}
function useIndex() {
  const doc = useDesign();
  return useMemo(() => {
    const value = slice(doc);
    return { page: value.page, entries: buildIndex(value.nodes) };
  }, [doc]);
}
export function FindLayersPanel() {
  const open = usePanelOpen("find");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = /Mac/.test(navigator.platform) ? e.metaKey : e.ctrlKey;
      if (
        !mod ||
        e.shiftKey ||
        e.altKey ||
        e.isComposing ||
        (e.key.toLowerCase() !== "f" && e.code !== "KeyF") ||
        !paletteKeyAllowed(e.target)
      )
        return;
      if (
        e.target instanceof Element &&
        e.target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
        ) &&
        e.target.id !== "find-layers-input"
      )
        return;
      if (
        [...document.querySelectorAll('dialog[open], [role="dialog"]')].some(
          (el) => el.getClientRects().length,
        )
      )
        return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setPanelOpen("find", true);
      document.getElementById("find-layers-input")?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return open ? <Finder /> : null;
}
function Finder() {
  const index = useIndex();
  const [query, setQuery] = useState(lastQuery);
  const results = useMemo(() => search(index.entries, query), [index, query]);
  const [activeId, setActiveId] = useState(lastActiveId);
  const position = Math.max(
    0,
    results.findIndex((r) => r.id === activeId),
  );
  const setPosition = (next: number) => {
    lastActiveId = results[next]?.id ?? null;
    setActiveId(lastActiveId);
  };
  const previousSelection = useRef(design().getSelection());
  const previousCamera = useRef(design().getCamera());
  const previousPage = useRef(index.page);
  const cancel = () => {
    if (index.page === previousPage.current) {
      design().setSelection(previousSelection.current);
      const { x, y, zoom } = previousCamera.current;
      design().setCamera(x, y, zoom);
    }
    close();
  };
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const current = results[Math.min(position, results.length - 1)];
  useEffect(() => {
    design().setSelection([]);
    input.current?.focus();
    input.current?.select();
  }, []);

  useEffect(() => {
    const dismiss = (e: PointerEvent) => {
      if (
        e.target instanceof Element &&
        !panel.current?.contains(e.target) &&
        !e.target.closest("#find-layers-button")
      )
        close();
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, []);
  useEffect(() => {
    if (!current) return;
    frameResult(current.id, panel.current);
    const highlight = () =>
      document
        .querySelector(`#canvas [data-id="${CSS.escape(current.id)}"]`)
        ?.setAttribute("data-find-focus", "");
    highlight();
    const removeSpotlight = spotlightResult(current.id);
    const unsubscribe = design().subscribe(() => highlight());
    document.getElementById(`find-option-${current.id}`)?.scrollIntoView({ block: "nearest" });
    return () => {
      unsubscribe();
      removeSpotlight();
      document
        .querySelectorAll("[data-find-focus]")
        .forEach((n) => n.removeAttribute("data-find-focus"));
    };
  }, [current]);
  // Window the result set in batches; every result remains reachable with the arrow keys.
  const start = Math.floor(position / 200) * 200;
  return (
    <div
      ref={panel}
      id="find-layers"
      role="search"
      aria-label="Find layers"
      className="absolute top-2 right-2 z-30 w-70 overflow-hidden rounded-xl border border-toolbar-edge bg-background text-xs text-foreground shadow-toolbar"
      onWheel={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) close();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
        if (e.key === "Enter" && current) {
          e.preventDefault();
          design().setSelection([current.id]);
          close();
        }
        if ((e.key === "ArrowDown" || e.key === "ArrowUp") && results.length) {
          e.preventDefault();
          setPosition(
            (position + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length,
          );
        }
      }}
    >
      <div className="flex h-11 items-center gap-2 border-b border-edge px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={input}
          id="find-layers-input"
          aria-label="Find layers"
          placeholder="Find layers"
          maxLength={1000}
          value={query}
          aria-controls="find-layers-results"
          aria-activedescendant={current ? `find-option-${current.id}` : undefined}
          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          onChange={(e) => {
            lastQuery = e.target.value;
            setQuery(lastQuery);
            lastActiveId = null;
            setActiveId(null);
          }}
        />
        {current && (
          <span id="find-layers-count" className="shrink-0 text-muted-foreground tabular-nums">
            {position + 1} of {results.length}
          </span>
        )}
        <button
          type="button"
          aria-label="Close"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring"
          onClick={cancel}
        >
          <X className="size-4" />
        </button>
      </div>
      {!query.trim() ? (
        <p className="px-3 py-6 text-center text-muted-foreground">
          Search by layer name, text, or ID
        </p>
      ) : !results.length ? (
        <div className="flex flex-col items-center gap-3 px-3 py-6 text-muted-foreground">
          <SearchX className="size-4" />
          <p className="max-w-full truncate">No layers found for “{query.trim()}”</p>
        </div>
      ) : (
        <div
          id="find-layers-results"
          role="listbox"
          aria-label="Matching layers"
          className="max-h-83 overflow-y-auto overscroll-contain p-1.5"
        >
          {results.slice(start, start + 200).map((result, offset) => {
            const Icon =
              result.type === "text"
                ? Type
                : result.type === "frame"
                  ? Frame
                  : result.type === "image"
                    ? Image
                    : result.type === "shader"
                      ? Sparkles
                      : Square;
            return (
              <button
                type="button"
                tabIndex={-1}
                role="option"
                id={`find-option-${result.id}`}
                key={result.id}
                data-find-result={result.id}
                aria-selected={current?.id === result.id}
                className={cn(
                  "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left",
                  current?.id === result.id
                    ? "bg-find-active text-primary-foreground"
                    : "hover:bg-muted",
                  (result.hidden || result.locked) && "opacity-60",
                )}
                onClick={() => {
                  setPosition(start + offset);
                  frameResult(result.id, panel.current);
                  input.current?.focus();
                }}
              >
                <Icon className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {result.snippet.before}
                  <u>{result.snippet.hit}</u>
                  {result.snippet.after}
                </span>
                {result.idText && (
                  <span className="max-w-24 truncate text-right underline">{result.idText}</span>
                )}
              </button>
            );
          })}
          {results.length > 200 && (
            <p className="p-2 text-muted-foreground">
              Use arrow keys to browse all {results.length} matches
            </p>
          )}
        </div>
      )}
    </div>
  );
}
