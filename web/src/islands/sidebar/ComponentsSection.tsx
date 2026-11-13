// "Components" section (design/component-audit/README.md "Components panel"; Pen 10-components-panel): every main
// component of the document with a live thumbnail, search, click to insert an instance in the middle of the
// viewport, drag onto the canvas to insert it at the drop point, and the App shell / Page shell presets.
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent } from "react";
import { LayoutTemplate, PanelsTopLeft, Search } from "lucide-react";
import { ComponentMainIcon } from "@/components/icons";
import { design } from "@/lib/bridge";
import {
  insertInstance,
  insertPreset,
  listMains,
  listenForNotices,
  type MainEntry,
} from "@/lib/components";
import { cn } from "@/lib/utils";
import { IconButton, SectionHeader } from "./parts";
import { useDesignSlice } from "./hooks";

const DRAG_TYPE = "application/x-verynize-component";

/** Canvas drop target for dragged components, installed once (the canvas lives outside React). */
let dropInstalled = false;
function installCanvasDrop() {
  const wrap = document.getElementById("canvas-wrap");
  if (dropInstalled || !wrap) return;
  dropInstalled = true;
  const ours = (e: globalThis.DragEvent) => !!e.dataTransfer?.types.includes(DRAG_TYPE);
  wrap.addEventListener("dragover", (e) => {
    if (!ours(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  wrap.addEventListener("drop", (e) => {
    if (!ours(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer?.getData(DRAG_TYPE);
    const toWorld = design().screenToWorld as (x: number, y: number) => { x: number; y: number };
    if (id) insertInstance(id, toWorld(e.clientX, e.clientY));
  });
}

/**
 * A picture of the main as the canvas draws it: a clone of its canvas element, scaled into the card (no ids or
 * selection chrome, so it never matches canvas selectors). Mains on other pages are not drawn and show their icon.
 */
function Thumbnail({ id, version }: { id: string; version: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState(false);
  useLayoutEffect(() => {
    const host = box.current;
    if (!host) return;
    const source = document.querySelector<HTMLElement>(
      `#canvas .layer[data-id="${CSS.escape(id)}"]`,
    );
    host.replaceChildren();
    setDrawn(!!source);
    if (!source || !source.offsetWidth) return;
    const clone = source.cloneNode(true) as HTMLElement;
    for (const el of [clone, ...clone.querySelectorAll<HTMLElement>("*")]) {
      el.removeAttribute("id");
      for (const name of el.getAttributeNames())
        if (name.startsWith("data-")) el.removeAttribute(name);
      el.classList.remove("selected", "layer", "frame-layer");
    }
    for (const handle of clone.querySelectorAll(".handle")) handle.remove();
    const k = Math.min(
      host.clientWidth / source.offsetWidth,
      host.clientHeight / source.offsetHeight,
    );
    Object.assign(clone.style, {
      position: "absolute",
      left: `${(host.clientWidth - source.offsetWidth * k) / 2}px`,
      top: `${(host.clientHeight - source.offsetHeight * k) / 2}px`,
      transform: `scale(${k})`,
      transformOrigin: "0 0",
      rotate: "none",
      translate: "none",
      pointerEvents: "none",
      outline: "none",
    });
    host.append(clone);
  }, [id, version]);
  return (
    <div className="relative h-18 w-full overflow-hidden rounded-md bg-canvas" aria-hidden>
      <div ref={box} className="absolute inset-1.5 overflow-hidden" />
      {!drawn ? (
        <ComponentMainIcon className="absolute inset-0 m-auto size-5 text-component" />
      ) : null}
    </div>
  );
}

/** Bumps after the canvas settles (debounced), so thumbnails follow edits without redrawing on every pointer move. */
function useCanvasVersion(active: boolean) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!active) return;
    let timer = 0;
    const off = design().subscribe(() => {
      clearTimeout(timer);
      timer = window.setTimeout(() => setVersion((v) => v + 1), 250);
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [active]);
  return version;
}

function MainCard({ main, version }: { main: MainEntry; version: number }) {
  const onDragStart = (e: DragEvent<HTMLButtonElement>) => {
    e.dataTransfer.setData(DRAG_TYPE, main.id);
    e.dataTransfer.effectAllowed = "copy";
  };
  return (
    <button
      type="button"
      draggable
      data-component-card={main.id}
      title={`Insert ${main.name}`}
      onDragStart={onDragStart}
      onClick={() => insertInstance(main.id)}
      className="flex min-w-0 flex-col gap-1 rounded-md p-1 text-left hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring"
    >
      <Thumbnail id={main.id} version={version} />
      <span className="flex min-w-0 items-center gap-1 px-0.5">
        <ComponentMainIcon className="size-3 shrink-0 text-component" />
        <span className="truncate text-xs text-foreground-2">{main.name}</span>
      </span>
      <span className="truncate px-0.5 text-xs text-subtle-foreground">
        {main.instances === 1 ? "1 instance" : `${main.instances} instances`} · {main.pageName}
      </span>
    </button>
  );
}

export function ComponentsSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const mains = useDesignSlice((doc) => listMains(doc));
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const version = useCanvasVersion(open);
  useEffect(() => {
    listenForNotices();
    installCanvasDrop();
  }, []);
  const q = query.trim().toLowerCase();
  const shown = q ? mains.filter((m) => m.name.toLowerCase().includes(q)) : mains;

  return (
    <section
      aria-label="Components"
      id="components-panel"
      className={cn(
        "flex flex-col border-b border-divider",
        open ? "min-h-24 flex-1" : "min-h-9 shrink-0",
      )}
    >
      <SectionHeader
        title="Components"
        open={open}
        onToggle={onToggle}
        controls="bd-components-body"
      >
        <IconButton
          label="Search components"
          aria-pressed={searching}
          className={cn(searching && "bg-muted text-foreground")}
          onClick={() => {
            if (searching) {
              setSearching(false);
              setQuery("");
              return;
            }
            setSearching(true);
            if (!open) onToggle();
            requestAnimationFrame(() => searchRef.current?.focus());
          }}
        >
          <Search className="size-4" />
        </IconButton>
      </SectionHeader>
      <div
        id="bd-components-body"
        hidden={!open}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3"
      >
        {searching ? (
          <div className="flex h-7 shrink-0 items-center gap-2 rounded-md bg-input px-2 text-muted-foreground focus-within:outline focus-within:outline-1 focus-within:outline-ring">
            <Search className="size-3.5 shrink-0" />
            <input
              ref={searchRef}
              id="components-search"
              type="search"
              placeholder="Search components"
              aria-label="Search components"
              value={query}
              spellCheck={false}
              className="h-full min-w-0 flex-1 bg-transparent text-xs text-foreground"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                  setSearching(false);
                  setQuery("");
                }
              }}
            />
          </div>
        ) : null}
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            id="components-preset-app-shell"
            onClick={() => insertPreset("appShell")}
            className="flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md bg-input text-xs text-foreground-2 hover:bg-accent"
          >
            <PanelsTopLeft className="size-3.5 shrink-0 text-component" />
            <span className="truncate">App shell</span>
          </button>
          <button
            type="button"
            id="components-preset-page-shell"
            onClick={() => insertPreset("pageShell")}
            className="flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md bg-input text-xs text-foreground-2 hover:bg-accent"
          >
            <LayoutTemplate className="size-3.5 shrink-0 text-component" />
            <span className="truncate">Page shell</span>
          </button>
        </div>
        <div className="shrink-0">
          {shown.length ? (
            <div id="components-list" className="grid grid-cols-2 gap-1">
              {shown.map((main) => (
                <MainCard key={main.id} main={main} version={version} />
              ))}
            </div>
          ) : (
            <p className="py-2 text-xs text-subtle-foreground">
              {q
                ? "No matching components"
                : "No components yet. Select a frame and press ⌥⌘K, or start from a preset."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
