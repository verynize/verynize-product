// Multi-selection pieces (properties-audit A9; wonder A9-selection-colors-multiple / -bottom): when the selected
// layers disagree on a list property (background fills, box shadows, filters) its section shows one
// "Click to replace …" well instead of the rows; clicking it gives every selected layer the primary layer's list
// (one undo step), after which the normal rows show. "Selection filters" lists the distinct filters used by
// the selection and its descendants, each with a target button that selects the layers using it.
import type { ReactNode } from "react";
import { Target } from "lucide-react";
import type { DesignDocument, LayerNode } from "@/lib/bridge";
import { PlusIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { IconAffix, IconButton } from "./controls";
import { FILTER_SPECS } from "./filters";
import { listOf, type Filter } from "./effects";
import { paintsOf } from "./paints";
import { notify } from "./legacy";
import { pageNodes, type Node } from "./model";
import { coveredNodes } from "./selection-colors";

const selectedNodes = (doc: DesignDocument, selection: string[]) =>
  pageNodes(doc).filter((n) => selection.includes(n.id));

/** True when the selected layers do not all share the same value. */
function differs(nodes: Node[], read: (node: Node) => unknown) {
  if (nodes.length < 2) return false;
  const first = JSON.stringify(read(nodes[0]));
  return nodes.some((n) => JSON.stringify(read(n)) !== first);
}

/**
 * Paint rows edit every selected layer from its own paints (index by index), so fills only count as mixed when
 * the stacks differ in shape (count or paint types); same-shaped stacks keep their rows (e.g. detach-all).
 */
const fillsOf = (node: Node) => (node.type === "shader" ? null : paintsOf(node).map((p) => p.type));
export const mixedFills = (doc: DesignDocument, selection: string[]) =>
  differs(
    selectedNodes(doc, selection).filter((n) => n.type !== "shader"),
    fillsOf,
  );
export const mixedShadows = (doc: DesignDocument, selection: string[]) =>
  differs(selectedNodes(doc, selection), (n) => listOf(n, "shadows"));
export const mixedFilters = (doc: DesignDocument, selection: string[]) =>
  differs(selectedNodes(doc, selection), (n) => listOf(n, "filters"));

function patchSelection(selection: string[], patch: (node: Node) => Record<string, unknown>) {
  try {
    window.design.updateNodes(selection, (n) => patch(n as Node) as Partial<LayerNode>);
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
  }
}

/** Give every selected layer the primary layer's paints (fill stack or plain colour). */
export function replaceFills(primary: Node, selection: string[]) {
  const source = primary as Node & { fills?: unknown };
  patchSelection(selection, (n) =>
    n.type === "shader"
      ? {}
      : {
          fills: source.fills === undefined ? undefined : structuredClone(source.fills),
          color: primary.color,
          token: primary.token ?? "",
        },
  );
}
/** Give every selected layer the primary layer's list. */
export function replaceList(primary: Node, selection: string[], key: "shadows" | "filters") {
  const list = listOf(primary, key);
  patchSelection(selection, () => ({ [key]: list.length ? structuredClone(list) : undefined }));
}

/** A list section whose selected layers disagree: header (+ replaces too) and one "Click to replace …" well. */
export function MixedSection({
  id,
  title,
  label,
  onReplace,
  children,
  bodyClassName,
}: {
  id: string;
  title: string;
  label: string;
  onReplace: () => void;
  children?: ReactNode;
  /** Wonder: Shadow 5 above / 23 below the well; Filters 1 above, 10 below its Selection filters rows. */
  bodyClassName?: string;
}) {
  return (
    <section id={id} className="border-b border-border" data-mixed>
      <div className="flex h-7.75 items-center justify-between gap-2 px-3">
        <h3 className="truncate text-xs text-foreground-3">{title}</h3>
        <IconButton icon={PlusIcon} label={label} onClick={onReplace} />
      </div>
      <div className={cn("flex flex-col gap-2 px-3 pt-1.25 pb-5.75", bodyClassName)}>
        <ReplaceWell label={label} onClick={onReplace} />
        {children}
      </div>
    </section>
  );
}

/** Wonder's well: x 12–268, 26 tall with its 1px edge, #181818 fill, centred muted label. */
function ReplaceWell({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      data-replace={label}
      className="flex h-6.5 w-full items-center justify-center rounded-md border border-well-edge bg-well text-xs text-muted-foreground hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

type FilterGroup = { key: string; filter: Filter; ids: string[] };

/** Distinct filters (type and layer/backdrop) of the selection and its descendants. */
export function selectionFilters(doc: DesignDocument, selection: string[]): FilterGroup[] {
  const groups = new Map<string, FilterGroup>();
  for (const node of coveredNodes(doc, selection))
    for (const filter of listOf<Filter>(node, "filters")) {
      const key = (filter.backdrop ? "backdrop:" : "layer:") + filter.type;
      const group = groups.get(key);
      if (!group) groups.set(key, { key, filter, ids: [node.id] });
      else if (!group.ids.includes(node.id)) group.ids.push(node.id);
    }
  return [...groups.values()];
}

/** "Selection filters" (multi-selection): read-only rows with a target button, under the Filters list. */
export function SelectionFilters({
  doc,
  selection,
  standalone,
}: {
  doc: DesignDocument;
  selection: string[];
  /** Rendered as its own section (the Filters list above is not mixed). */
  standalone?: boolean;
}) {
  const groups = selectionFilters(doc, selection);
  if (selection.length < 2 || !groups.length) return null;
  const body = (
    <div className="flex flex-col gap-2" data-selection-filters={groups.length}>
      <h4 className="h-11.5 pt-5 text-xs text-muted-foreground">Selection filters</h4>
      {groups.map(({ key, filter, ids }) => {
        const spec = FILTER_SPECS[filter.type];
        const name = (filter.backdrop ? "Backdrop " : "") + (spec?.label ?? filter.type);
        return (
          <div key={key} className="flex items-center gap-2" data-selection-filter={key}>
            <div className="flex h-6 min-w-0 flex-1 items-center gap-2.5 rounded-md border border-well-edge bg-well pl-1.5 text-xs text-foreground">
              {spec ? <IconAffix icon={spec.icon} /> : null}
              <span className="truncate">{name}</span>
            </div>
            <IconButton
              icon={Target}
              label={`Select layers using ${name.toLowerCase()}`}
              data-selection-filter-target={key}
              onClick={() => window.design.setSelection(ids)}
            />
          </div>
        );
      })}
    </div>
  );
  return standalone ? (
    <section id="selection-filters-section" className="border-b border-border px-3 pb-2.5">
      {body}
    </section>
  ) : (
    body
  );
}
