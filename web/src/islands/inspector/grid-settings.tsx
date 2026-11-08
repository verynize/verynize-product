// Grid mode of the Layout section (properties-audit G5 / H7, design/wonder/properties-audit/wonder/G5-*.png, H7-*.png):
// the header's "Automatic positioning" toggle and "Grid settings" button, the track preview, and the Grid settings
// popover (Columns / Rows, one "Fill · 1 fr" row per track, "Rows are added to fit content" while rows are auto).
import { useRef, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import { GridLayoutIcon, PlusIcon, RemoveIcon, WrapIcon } from "@/components/icons";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Tip } from "../chrome/tip";
import { Field, IconAffix, IconButton, NativeSelect } from "./controls";
import { notify } from "./legacy";
import { patchNodes, type Node } from "./model";

type Props = { node: Node; selection: string[] };
type Axis = "columns" | "rows";

/** The inspector's track limit (the renderer accepts up to 100). */
const MAX_TRACKS = 12;
/** Active header toggles take Wonder's purple tint (C3-flex-wrap-on, H7-grid-header). */
const TOGGLE = "data-active:bg-toggle-active data-active:text-toggle-active-foreground";
const SIZES = { columns: "columnSizes", rows: "rowSizes" } as const;

const count = (node: Node, axis: Axis) => {
  const v = Number(node[axis]);
  if (axis === "columns") return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 2;
  return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 0;
};
/** fr weight of each track ("Fill · N fr"); missing weights are 1. */
const weightsOf = (node: Node, axis: Axis, n = count(node, axis)) => {
  const sizes = node[SIZES[axis]];
  return Array.from({ length: n }, (_, i) => {
    const w = Array.isArray(sizes) ? Number(sizes[i]) : NaN;
    return Number.isFinite(w) && w > 0 ? w : 1;
  });
};
/** Stored form: one weight per track, or nothing when every track is 1 fr. */
const sizesPatch = (axis: Axis, weights: number[]) => ({
  [SIZES[axis]]: weights.some((w) => w !== 1) ? weights : undefined,
});
const fmtWeight = (w: number) => String(Math.round(w * 100) / 100);

/** Header tools in grid mode: Automatic positioning (on by default) and Grid settings. */
export function GridHeaderTools({ node, selection }: Props) {
  const auto = node.autoPosition !== false;
  const [open, setOpen] = useState(false);
  const tool = useRef<HTMLButtonElement>(null);
  // Wonder opens Grid settings beside the panel (4px gap), its top level with the header tool.
  const anchor = useRef({
    getBoundingClientRect: () => {
      const box = tool.current?.getBoundingClientRect();
      const panel = document.getElementById("properties")?.getBoundingClientRect();
      return new DOMRect(panel?.left ?? box?.left ?? 0, box?.top ?? 0, 0, box?.height ?? 0);
    },
  });
  return (
    <>
      <Tip label="Automatic positioning">
        <IconButton
          icon={WrapIcon}
          label="Automatic positioning"
          title={undefined}
          active={auto}
          aria-pressed={auto}
          data-grid-wrap={auto ? "auto" : "off"}
          className={TOGGLE}
          // Wonder H7-wrap-off: the toggle keeps the track counts (4 × 2 stays 4 × 2).
          onClick={() => patchNodes(selection, () => ({ autoPosition: auto ? false : undefined }))}
        />
      </Tip>
      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <PopoverAnchor virtualRef={anchor} />
        <Tip label="Grid settings">
          <IconButton
            ref={tool}
            icon={GridLayoutIcon}
            label="Grid settings"
            title={undefined}
            active={open}
            aria-expanded={open}
            data-grid-tracks-tool
            onClick={() => setOpen(!open)}
          />
        </Tip>
        <PopoverContent
          id="grid-settings"
          side="left"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="w-72"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest?.("[data-grid-tracks-tool], #grid-tracks")) event.preventDefault();
          }}
        >
          <GridSettings node={node} selection={selection} onClose={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
    </>
  );
}

function GridSettings({ node, selection, onClose }: Props & { onClose: () => void }) {
  return (
    // -m-3 cancels the shared popover padding: Wonder's rows run edge to edge (G5-track-editor).
    <div className="-m-3 flex flex-col text-xs">
      <div className="flex h-10 items-center justify-between pr-2 pl-3">
        <span className="text-sm text-foreground">Grid settings</span>
        <IconButton icon={X} label="Close grid settings" onClick={onClose} />
      </div>
      <Tracks axis="columns" node={node} selection={selection} />
      <Tracks axis="rows" node={node} selection={selection} />
    </div>
  );
}

function Tracks({ axis, node, selection }: Props & { axis: Axis }) {
  const n = count(node, axis);
  const weights = weightsOf(node, axis, n);
  const noun = axis === "columns" ? "column" : "row";
  const title = axis === "columns" ? "Columns" : "Rows";
  const add = () =>
    patchNodes(selection, (m) => {
      const k = count(m, axis);
      const next = [...weightsOf(m, axis, k), 1];
      return {
        [axis]: Math.min(MAX_TRACKS, k + 1),
        ...sizesPatch(axis, next.slice(0, MAX_TRACKS)),
      };
    });
  const remove = (index: number) =>
    patchNodes(selection, (m) => {
      const k = count(m, axis);
      const next = weightsOf(m, axis, k).filter((_, i) => i !== index);
      // Removing the last explicit row returns to automatic rows; a grid keeps at least one column.
      if (axis === "rows" && !next.length) return { rows: undefined, rowSizes: undefined };
      return { [axis]: Math.max(1, k - 1), ...sizesPatch(axis, next) };
    });
  const setWeight = (index: number) => (raw: string) => {
    const v = Number(raw.trim());
    if (raw.trim() === "" || !Number.isFinite(v) || v <= 0) {
      notify("Enter a number greater than 0.");
      return;
    }
    const w = Math.min(1000, Math.round(v * 100) / 100);
    patchNodes(selection, (m) => {
      const next = weightsOf(m, axis);
      if (index >= next.length) return {};
      next[index] = w;
      return sizesPatch(axis, next);
    });
  };
  return (
    <section
      data-grid-axis={axis}
      className={cn(
        "flex flex-col px-3",
        axis === "rows" ? "border-t border-edge pt-2" : "",
        axis === "rows" && !n ? "pb-3" : "pb-4",
      )}
    >
      <div className="flex h-6 items-center justify-between">
        <span className="text-muted-foreground">{title}</span>
        <IconButton
          icon={PlusIcon}
          label={`Add ${noun}`}
          data-grid-add={axis}
          disabled={n >= MAX_TRACKS}
          onClick={add}
        />
      </div>
      {n ? (
        <ol className="mt-2.5 flex flex-col gap-2">
          {weights.map((w, i) => (
            <li key={i} data-grid-track={i} className="group/track flex h-6 items-center">
              <span className="w-4.5 shrink-0 text-muted-foreground tabular-nums">{i + 1}</span>
              <NativeSelect
                label={`${title} ${i + 1} sizing`}
                value="fill"
                options={[{ value: "fill", label: "Fill" }]}
                onChange={() => undefined}
                className="w-26 shrink-0"
              />
              <Field
                name={`${noun}Size-${i}`}
                label={`${title} ${i + 1} fraction`}
                numeric
                step={1}
                value={fmtWeight(w)}
                onCommit={setWeight(i)}
                prefix={<IconAffix icon={GridLayoutIcon} />}
                suffix={
                  <NativeSelect
                    bare
                    label={`${title} ${i + 1} unit`}
                    value="fr"
                    options={[{ value: "fr", label: "fr" }]}
                    onChange={() => undefined}
                  />
                }
                className="ml-2 w-26 shrink-0"
              />
              <IconButton
                icon={RemoveIcon}
                label={`Remove ${noun} ${i + 1}`}
                data-grid-remove={axis}
                disabled={axis === "columns" && n <= 1}
                className="ml-auto opacity-0 group-hover/track:opacity-100 focus-visible:opacity-100 disabled:hidden"
                onClick={() => remove(i)}
              />
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-1.5 flex h-6 items-center text-muted-foreground">
          Rows are added to fit content
        </p>
      )}
    </section>
  );
}

/**
 * The 60px track preview (Wonder G5): one outline per track (columns × explicit rows, one full-height row while rows
 * are auto) with the "N × M" count over it. Clicking it opens Grid settings.
 */
export function GridPreview({ node }: { node: Node }) {
  const columns = count(node, "columns");
  const rows = count(node, "rows");
  const fr = (ws: number[]) => ws.map((w) => `minmax(0, ${w}fr)`).join(" ");
  // Track sizes go to inspector.css (#grid-tracks) as custom properties.
  const style = {
    "--grid-preview-columns": fr(weightsOf(node, "columns", Math.min(columns, MAX_TRACKS))),
    "--grid-preview-rows": fr(rows ? weightsOf(node, "rows", Math.min(rows, MAX_TRACKS)) : [1]),
  } as CSSProperties;
  const cells = Math.min(columns, MAX_TRACKS) * Math.max(1, Math.min(rows, MAX_TRACKS));
  return (
    <button
      type="button"
      id="grid-tracks"
      aria-label="Grid settings"
      // Wonder C4: a 60px dark well (#181818, 1px #242424 edge) with the track outlines inside.
      className="relative grid h-15 w-full gap-0.5 rounded-md border border-well-edge bg-well p-1 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
      style={style}
      onClick={() => document.querySelector<HTMLButtonElement>("[data-grid-tracks-tool]")?.click()}
    >
      {Array.from({ length: cells }, (_, i) => (
        <span key={i} aria-hidden data-grid-cell className="rounded-xs border border-well-edge" />
      ))}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="rounded-xs bg-well px-1">
          {columns} × {rows || "Auto"}
        </span>
      </span>
    </button>
  );
}
