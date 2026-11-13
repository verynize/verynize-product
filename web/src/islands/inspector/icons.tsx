// Icons (Wonder): the file's own icon library (`document.icons`) between Variables and Properties. Icons come from an
// uploaded or pasted SVG, or from a selected SVG layer; clicking one inserts it on the canvas as an image layer.
import { useRef, useState } from "react";
import {
  ClipboardPaste,
  FileUp,
  LayoutGrid,
  LayoutList,
  Pencil,
  Search,
  Shapes,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { PlusIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import type { DesignDocument, DesignIcon } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import { IconButton } from "./controls";
import type { Node } from "./model";
import { PanelSectionHeader } from "./variables";

const SVG_PREFIX = "data:image/svg+xml;base64,";
const VIEW_KEY = "bd:icons-view";
type View = "grid" | "list";

/* ---------- SVG helpers ---------- */
const toBase64 = (text: string) => {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const fromBase64 = (data: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));

/** Parse and clean SVG markup (no scripts, event handlers or external references). Returns null when it is not SVG. */
function cleanSvg(markup: string): SVGSVGElement | null {
  return window.sanitizeSvg(markup);
}

/** Intrinsic size from width/height, else the viewBox; 24px when neither says. */
function svgSize(svg: SVGSVGElement) {
  const box = (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  const read = (key: "width" | "height", fallback: number | undefined) => {
    const value = parseFloat(svg.getAttribute(key) ?? "");
    return Number.isFinite(value) && !(svg.getAttribute(key) ?? "").endsWith("%")
      ? value
      : fallback;
  };
  const w = read("width", box.length === 4 ? box[2] : undefined) ?? 24;
  const h = read("height", box.length === 4 ? box[3] : undefined) ?? w;
  const clamp = (v: number) => Math.round(Math.min(512, Math.max(8, v)));
  return { w: clamp(w), h: clamp(h) };
}

/** SVG text of an image layer's embedded source, if it is an SVG. */
function svgOfNode(node: Node | undefined): string | null {
  const src = typeof node?.src === "string" ? node.src : "";
  const match = /^data:image\/svg\+xml(;[^,]*)?,(.*)$/s.exec(src);
  if (!match) return null;
  try {
    return match[1]?.includes("base64") ? fromBase64(match[2]) : decodeURIComponent(match[2]);
  } catch {
    return null;
  }
}

/* ---------- Library edits (validated, one undo step each) ---------- */
const library = (): DesignIcon[] =>
  (window.design.getDocument().icons as DesignIcon[] | undefined) ?? [];

function save(icons: DesignIcon[]) {
  try {
    window.design.setIcons(icons);
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
    return false;
  }
}

/** Add SVGs to the library; returns how many were valid. */
function addIcons(entries: { name: string; markup: string }[]) {
  const added: DesignIcon[] = [];
  for (const { name, markup } of entries) {
    const svg = cleanSvg(markup);
    if (!svg) continue;
    const title = svg.querySelector("title")?.textContent?.trim();
    const src = SVG_PREFIX + toBase64(new XMLSerializer().serializeToString(svg));
    if (src.length > 200_000) {
      toast.error("Icon source exceeds 200,000 characters.");
      continue;
    }
    added.push({
      id: crypto.randomUUID(),
      name: (name.trim() || title || `Icon ${library().length + added.length + 1}`).slice(0, 100),
      src,
    });
  }
  if (!added.length) {
    toast.error("That isn't valid SVG markup");
    return 0;
  }
  return save([...library(), ...added]) ? added.length : 0;
}

function insertIcon(icon: DesignIcon) {
  try {
    let svg: SVGSVGElement | null;
    try {
      svg = icon.src.startsWith(SVG_PREFIX)
        ? cleanSvg(fromBase64(icon.src.slice(SVG_PREFIX.length)))
        : null;
    } catch {
      throw new Error("This icon contains invalid SVG data. Upload or paste it again.");
    }
    if (!svg) throw new Error("This icon contains invalid SVG data. Upload or paste it again.");
    const { w, h } = svgSize(svg);
    const src = SVG_PREFIX + toBase64(new XMLSerializer().serializeToString(svg));
    window.design.addNode("image", { name: icon.name, w, h, color: "transparent", src });
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
}

async function renameIcon(icon: DesignIcon) {
  const name = (await window.askText?.("Icon name", icon.name))?.trim();
  if (!name || name === icon.name) return;
  save(library().map((i) => (i.id === icon.id ? { ...i, name: name.slice(0, 100) } : i)));
}

const deleteIcon = (icon: DesignIcon) => save(library().filter((i) => i.id !== icon.id));

/* ---------- UI ---------- */
function IconItem({ icon, view }: { icon: DesignIcon; view: View }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          data-icon-id={icon.id}
          aria-label={`Insert ${icon.name}`}
          title={icon.name}
          onClick={() => insertIcon(icon)}
          className={cn(
            "flex min-w-0 items-center rounded-md text-xs text-foreground-2 outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring",
            view === "grid" ? "aspect-square justify-center" : "h-7.5 gap-2 px-3",
          )}
        >
          <img
            src={icon.src}
            alt=""
            draggable={false}
            className="pointer-events-none size-4.5 shrink-0 object-contain opacity-100 filter-none"
          />
          {view === "list" ? <span className="truncate">{icon.name}</span> : null}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => insertIcon(icon)}>
          <PlusIcon />
          Insert
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void renameIcon(icon)}>
          <Pencil />
          Rename
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => deleteIcon(icon)}>
          <Trash2 />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function PasteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [markup, setMarkup] = useState("");
  const submit = () => {
    if (addIcons([{ name: "", markup }])) {
      setMarkup("");
      onOpenChange(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent id="icon-paste-dialog" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Paste SVG markup</DialogTitle>
        </DialogHeader>
        <Textarea
          autoFocus
          aria-label="SVG markup"
          placeholder={'<svg xmlns="http://www.w3.org/2000/svg" …>…</svg>'}
          value={markup}
          onChange={(event) => setMarkup(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
            event.stopPropagation();
          }}
          className="h-40"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button id="icon-paste-ok" disabled={!markup.trim()} onClick={submit}>
            Add icon
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function IconsSection({
  doc,
  node,
  open,
  onToggle,
  className,
}: {
  doc: DesignDocument;
  node: Node | undefined;
  open: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const icons = (doc.icons as DesignIcon[] | undefined) ?? [];
  const [view, setView] = useState<View>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
    } catch {
      return "grid"; // storage blocked: fall back to the default view
    }
  });
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [pasting, setPasting] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const selectedSvg = svgOfNode(node);
  const q = query.trim().toLowerCase();
  const shown = q ? icons.filter((i) => i.name.toLowerCase().includes(q)) : icons;
  const reveal = () => {
    if (!open) onToggle();
  };
  const toggleView = () => {
    const next = view === "grid" ? "list" : "grid";
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* cosmetic preference */
    }
  };

  return (
    <section
      id="insp-icons"
      aria-label="Icons"
      className={cn("flex flex-col border-b border-divider", className)}
    >
      <PanelSectionHeader
        label="Icons"
        count={icons.length}
        open={open}
        onToggle={onToggle}
        tools={
          <>
            <IconButton
              id="icons-view"
              icon={view === "grid" ? LayoutGrid : LayoutList}
              label={view === "grid" ? "Show as list" : "Show as grid"}
              onClick={() => {
                toggleView();
                reveal();
              }}
            />
            <IconButton
              icon={Search}
              label="Search icons"
              active={searching}
              onClick={() => {
                setSearching(!searching);
                reveal();
                if (searching) setQuery("");
              }}
            />
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <IconButton id="add-icon-asset" icon={PlusIcon} label="Add icon" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={4} className="w-48">
                <DropdownMenuItem id="icon-upload" onSelect={() => file.current?.click()}>
                  <FileUp />
                  Upload SVG
                </DropdownMenuItem>
                <DropdownMenuItem id="icon-paste" onSelect={() => setPasting(true)}>
                  <ClipboardPaste />
                  Paste SVG markup
                </DropdownMenuItem>
                <DropdownMenuItem
                  id="icon-from-selection"
                  disabled={!selectedSvg}
                  onSelect={() => {
                    if (selectedSvg && addIcons([{ name: node?.name ?? "", markup: selectedSvg }]))
                      reveal();
                  }}
                >
                  <PlusIcon />
                  Add from selection
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <input
        ref={file}
        type="file"
        accept=".svg,image/svg+xml"
        multiple
        hidden
        aria-label="Upload SVG icons"
        onChange={async (event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (!files.length) return;
          try {
            window.imageUpload.batch(files);
            if (files.some((f) => f.size > 1_000_000))
              throw Error("SVG images must be at most 1 MB.");
          } catch (error) {
            toast.error(String(error));
            return;
          }
          const entries = await Promise.all(
            files.map(async (f) => ({
              name: f.name.replace(/\.svg$/i, ""),
              markup: await f.text(),
            })),
          );
          if (addIcons(entries)) reveal();
        }}
      />
      <div hidden={!open} data-scroll className="min-h-0 flex-1 overflow-y-auto pb-2">
        {searching ? (
          <div className="px-3 pb-2">
            <input
              autoFocus
              aria-label="Search icons"
              placeholder="Search icons"
              value={query}
              className="h-6 w-full rounded-md bg-input px-2 text-xs text-foreground shadow-field outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setQuery("");
                  setSearching(false);
                }
                event.stopPropagation();
              }}
            />
          </div>
        ) : null}
        {!icons.length ? (
          <div className="flex flex-col items-center gap-2.5 px-4 pt-8 pb-4 text-center">
            <Shapes className="size-4 text-foreground-3" aria-hidden />
            <p className="text-xs text-foreground-3">
              Reuse icons across this file. Upload or paste SVG with the + above, or add a selected
              SVG layer.
            </p>
          </div>
        ) : !shown.length ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">No matching icons</p>
        ) : (
          <div
            role="list"
            aria-label="Icon library"
            className={cn(view === "grid" ? "grid grid-cols-8 gap-0.5 px-2" : "flex flex-col")}
          >
            {shown.map((icon) => (
              <div key={icon.id} role="listitem" className="contents">
                <IconItem icon={icon} view={view} />
              </div>
            ))}
          </div>
        )}
      </div>
      <PasteDialog open={pasting} onOpenChange={setPasting} />
    </section>
  );
}
