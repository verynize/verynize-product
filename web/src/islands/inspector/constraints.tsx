// Constraints (design/wonder 25, 45; properties-audit B4): how a positioned layer anchors to its parent when the
// parent resizes. They are CSS insets (see `constraintsOf` in web/node-style.js); the canvas re-derives the insets so
// changing a constraint never moves the layer. Artboards and auto-layout children have none, so the controls are
// disabled.
import type { MouseEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { fieldShell } from "./controls";

export type Anchor = "start" | "end" | "stretch" | "center" | "scale";
type Constraints = { h: Anchor; v: Anchor };

const LABELS: Record<"h" | "v", Record<Anchor, string>> = {
  h: { start: "Left", end: "Right", stretch: "Left & Right", center: "Center", scale: "Scale" },
  v: { start: "Top", end: "Bottom", stretch: "Top & Bottom", center: "Center", scale: "Scale" },
};
const ORDER: Anchor[] = ["start", "end", "stretch", "center", "scale"];
/** Wonder's menu (B4-constraint-menu): only the two edges. Centre and Left & Right come from the diagram. */
const MENU: Anchor[] = ["start", "end"];

/** Constraints of each selected layer, or null when one of them cannot be constrained. */
export function readConstraints(selection: string[]): Constraints[] | null {
  const getter = window.design.getConstraints as ((id: string) => Constraints | null) | undefined;
  if (!getter || !selection.length) return null;
  const list = selection.map((id) => getter(id));
  return list.every(Boolean) ? (list as Constraints[]) : null;
}

function apply(selection: string[], next: Partial<Constraints>) {
  const setter = window.design.setConstraints as
    | ((ids: string[], constraints: Partial<Constraints>) => boolean)
    | undefined;
  setter?.(selection, next);
}

const shared = (list: Constraints[] | null, axis: "h" | "v"): Anchor | "mixed" => {
  if (!list) return "start";
  return list.every((c) => c[axis] === list[0][axis]) ? list[0][axis] : "mixed";
};

/**
 * Left / Right (Top / Bottom) field. The visible control is a menu like Wonder's; a transparent native select with
 * every anchor stays on top of it for scripts and tests (`select[name=constraintH]`), without taking pointer or
 * keyboard focus.
 */
export function ConstraintSelect({
  axis,
  selection,
  list,
}: {
  axis: "h" | "v";
  selection: string[];
  list: Constraints[] | null;
}) {
  const value = shared(list, axis);
  const label = axis === "h" ? "Horizontal constraint" : "Vertical constraint";
  const items = value === "mixed" || MENU.includes(value) ? MENU : [...MENU, value];
  return (
    <div className="relative min-w-0">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild disabled={!list}>
          <button
            type="button"
            aria-label={label}
            title={label}
            data-constraint-menu={axis}
            className={cn(
              fieldShell,
              // Purple ring while the menu is open (B4-constraint-menu); keyboard focus only otherwise.
              "w-full justify-between pr-2.5 text-left outline-none focus-within:ring-0 focus-visible:ring-1 focus-visible:ring-ring aria-expanded:ring-1 aria-expanded:ring-ring disabled:bg-field-disabled disabled:text-field-disabled-foreground disabled:opacity-100",
            )}
          >
            <span className="truncate">{value === "mixed" ? "Mixed" : LABELS[axis][value]}</span>
            <ChevronDown
              aria-hidden
              className="size-3 shrink-0 text-muted-foreground group-aria-expanded/field:rotate-180 group-disabled/field:text-disabled-glyph"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-38">
          {items.map((a) => (
            <DropdownMenuItem
              key={a}
              data-constraint-option={a}
              className="h-6"
              onSelect={() => apply(selection, { [axis]: a })}
            >
              <span className="flex-1">{LABELS[axis][a]}</span>
              {a === value ? <Check className="size-3.5 text-foreground" aria-hidden /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <select
        name={axis === "h" ? "constraintH" : "constraintV"}
        aria-hidden
        tabIndex={-1}
        value={value}
        disabled={!list}
        className="pointer-events-none absolute inset-0 size-full opacity-0"
        onChange={(event) => apply(selection, { [axis]: event.target.value as Anchor })}
      >
        {value === "mixed" ? (
          <option value="mixed" disabled>
            Mixed
          </option>
        ) : null}
        {ORDER.map((a) => (
          <option key={a} value={a}>
            {LABELS[axis][a]}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * The constraint diagram: edge ticks pin a side, the centre lines centre an axis. Shift-click the opposite
 * edge to pin both (Left & Right / Top & Bottom), like Figma.
 */
export function ConstraintWidget({
  selection,
  list,
}: {
  selection: string[];
  list: Constraints[] | null;
}) {
  const h = shared(list, "h"),
    v = shared(list, "v");
  const pick = (axis: "h" | "v", edge: "start" | "end" | "center") => (event: MouseEvent) => {
    const current = axis === "h" ? h : v;
    let next: Anchor = edge;
    if (edge !== "center" && event.shiftKey) {
      const other = edge === "start" ? "end" : "start";
      if (current === other || current === "stretch")
        next = current === "stretch" ? other : "stretch";
    }
    apply(selection, { [axis]: next });
  };
  const on = (axis: "h" | "v", edge: "start" | "end" | "center") => {
    const current = axis === "h" ? h : v;
    if (edge === "center") return current === "center";
    return current === edge || current === "stretch" || (current === "scale" && edge === "start");
  };
  // Wonder B4: active #a245d3, inactive #707070; disabled ticks are all a flat #535353 (no purple).
  const tick = (active: boolean) =>
    cn(
      "block rounded-full",
      !list
        ? "bg-disabled-glyph"
        : active
          ? "bg-primary"
          : "bg-subtle-foreground group-hover:bg-foreground-2",
    );
  // A render helper, not a component: a component defined here would remount (and drop focus) on every render.
  const renderEdge = ({
    axis,
    edge,
    label,
    className,
    bar,
  }: {
    axis: "h" | "v";
    edge: "start" | "end" | "center";
    label: string;
    className: string;
    bar: string;
  }) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on(axis, edge)}
      disabled={!list}
      data-constraint={axis + "-" + edge}
      onClick={pick(axis, edge)}
      className={cn(
        "group absolute flex items-center justify-center outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-100",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          bar,
          tick(!!list && on(axis, edge)),
          // Like Wonder, the centre lines only show while the diagram is hovered (or when centred).
          edge === "center" &&
            !(list && on(axis, edge)) &&
            "opacity-0 group-hover/constraints:opacity-100",
          edge === "center" && !list && "hidden",
        )}
      />
    </button>
  );
  return (
    <div
      role="group"
      aria-label="Constraints"
      data-disabled={!list || undefined}
      className={cn(
        "group/constraints relative row-span-2 h-full min-h-14 rounded-md shadow-field",
        // Wonder B4: the enabled well is the field fill (#2b2b2b); the disabled one is lighter (#363636).
        list ? "bg-input" : "bg-accent",
      )}
    >
      {/* 2×12px ticks: horizontal ones 9.5px in from the side, vertical ones 6px from the top/bottom. */}
      {renderEdge({
        axis: "v",
        edge: "start",
        label: "Pin top",
        className: "inset-x-6 top-0 h-6",
        bar: "h-3 w-0.5",
      })}
      {renderEdge({
        axis: "v",
        edge: "end",
        label: "Pin bottom",
        className: "inset-x-6 bottom-0 h-6",
        bar: "h-3 w-0.5",
      })}
      {renderEdge({
        axis: "h",
        edge: "start",
        label: "Pin left",
        className: "inset-y-6 left-0 w-7.75",
        bar: "h-0.5 w-3",
      })}
      {renderEdge({
        axis: "h",
        edge: "end",
        label: "Pin right",
        className: "inset-y-6 right-0 w-7.75",
        bar: "h-0.5 w-3",
      })}
      {renderEdge({
        axis: "h",
        edge: "center",
        label: "Center horizontally",
        className: "top-6 bottom-6 left-1/2 w-3 -translate-x-1/2",
        bar: "h-3 w-0.5",
      })}
      {renderEdge({
        axis: "v",
        edge: "center",
        label: "Center vertically",
        className: "top-1/2 left-7.75 right-7.75 h-3 -translate-y-1/2",
        bar: "h-0.5 w-3",
      })}
    </div>
  );
}
