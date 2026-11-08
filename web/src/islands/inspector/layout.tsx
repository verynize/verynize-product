// Layout section (design/wonder Layout panel): Display, size + min/max limits, then the controls of the chosen display
// (Flex: direction, 3×3 alignment, distribution, baseline, reverse, wrap, gaps · Grid: tracks, gaps, cell alignment ·
// Block: vertical spacing and alignment), the layer's own placement inside its parent (Grid child spans, Margin) and
// Padding.
import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import {
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartVertical,
  ArrowDownToLine,
  ArrowRightLeft,
  Check,
  ChevronDown,
  CirclePercent,
  MoveHorizontal,
} from "lucide-react";
import {
  AutoLayoutIcon,
  BlockLayoutIcon,
  ColumnsIcon,
  DistributeAroundXIcon,
  DistributeAroundYIcon,
  DistributeBetweenXIcon,
  DistributeBetweenYIcon,
  DistributeEvenlyXIcon,
  DistributeEvenlyYIcon,
  FlexLayoutIcon,
  FreeLayoutIcon,
  GapXIcon,
  GapYIcon,
  GridLayoutIcon,
  MarginBottomIcon,
  MarginLeftIcon,
  MarginRightIcon,
  MarginSidesIcon,
  MarginTopIcon,
  MarginXIcon,
  MarginYIcon,
  PaddingBottomIcon,
  PaddingLeftIcon,
  PaddingRightIcon,
  PaddingSidesIcon,
  PaddingTopIcon,
  PaddingXIcon,
  PaddingYIcon,
  RowsIcon,
  SizeAutoIcon,
  SizeCalcIcon,
  SizeFixedIcon,
  SizeHugIcon,
  SizeMaxIcon,
  SizeMinIcon,
  SizeOptionsIcon,
  WrapIcon,
} from "@/components/icons";
import type { DesignDocument } from "@/lib/bridge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { BindableField } from "./bind";
import { GridHeaderTools, GridPreview } from "./grid-settings";
import { Tip } from "../chrome/tip";
import {
  Affix,
  Caption,
  Field,
  IconAffix,
  IconButton,
  Section,
  Segmented,
  type IconType,
} from "./controls";
import { notify } from "./legacy";
import {
  fmt,
  pageNodes,
  parentOf,
  patchNodes,
  setField,
  sizingAllowed,
  sizingMode,
  type Node,
  type SizingMode,
} from "./model";

type Props = { doc: DesignDocument; node: Node; selection: string[] };
type Patch = Record<string, unknown>;
type Side = number | "auto";

const num = (v: unknown, fallback = 0) => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
};
const r2 = (v: number) => Math.round(v * 100) / 100;
const isFlow = (n: Node | undefined) => !!n && n.type === "frame" && n.layout !== "free";
/** Patch that drops a variable binding, so typing a value detaches the property (as in model.setField). */
function unbind(node: Node, ...keys: string[]): Patch {
  if (!keys.some((key) => node.bindings?.[key])) return {};
  const rest = Object.fromEntries(
    Object.entries(node.bindings ?? {}).filter(([key]) => !keys.includes(key)),
  );
  return { bindings: Object.keys(rest).length ? rest : undefined };
}
/** Parse a typed length; `min` clamps (padding and gap cannot go negative). */
function parseLength(raw: string, min = -Infinity): number | null {
  const v = Number(raw.trim());
  if (raw.trim() === "" || !Number.isFinite(v)) {
    notify("Enter a number.");
    return null;
  }
  return Math.max(min, Math.round(v * 100) / 100);
}
/** Calculate expressions are parsed by the shared node-style engine (web/node-style.js), like the canvas. */
type CalcApi = { parseCalc: (expr: string) => { pct: number; px: number; text: string } | null };
const calcApi = () => (window as unknown as { BetterNodeStyle: CalcApi }).BetterNodeStyle;

/* ---------- Shared rows ---------- */
/** Two field columns plus Wonder's 24px trailing tool column. */
export function Row({
  children,
  tool,
  className,
}: {
  children: ReactNode;
  tool?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-2", className)}>
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">{children}</div>
      <div className="flex w-6 shrink-0 flex-col items-center gap-2">{tool}</div>
    </div>
  );
}

function NumberField({
  name,
  label,
  icon,
  value,
  placeholder,
  unit,
  disabled,
  className,
  onCommit,
}: {
  name: string;
  label: string;
  icon: IconType;
  value: string;
  placeholder?: string;
  unit?: ReactNode;
  disabled?: boolean;
  className?: string;
  onCommit: (raw: string) => void;
}) {
  return (
    <Field
      name={name}
      label={label}
      numeric
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      onCommit={onCommit}
      prefix={<IconAffix icon={icon} />}
      suffix={unit}
    />
  );
}

/**
 * The unit at the end of a field doubles as its menu trigger (Wonder B2 / C7): "px ▾", "Hug ▾", "Auto ▾". The
 * chevron flips while the menu is open and the field shows its purple ring (focus-within on the shell).
 */
export function UnitTrigger({
  label,
  unit,
  ...props
}: { label: string; unit: string } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="group/unit flex h-6 items-center gap-0.5 text-muted-foreground outline-none hover:text-foreground"
      {...props}
    >
      {unit ? <span>{unit}</span> : null}
      <ChevronDown aria-hidden className="size-3 shrink-0 group-aria-expanded/unit:rotate-180" />
    </button>
  );
}

/** A 24px menu row with a leading icon and Wonder's trailing ✓ on the current choice. */
function MenuChoice({
  icon: Icon,
  label,
  checked,
  turn,
  onSelect,
  ...props
}: {
  icon?: IconType;
  label: string;
  checked?: boolean;
  /** Turn a horizontal glyph a quarter for the H axis. */
  turn?: boolean;
  onSelect: () => void;
} & Record<`data-${string}`, string>) {
  return (
    <DropdownMenuItem className="h-6" onSelect={onSelect} {...props}>
      {Icon ? (
        <span className={cn("flex size-3.5 items-center justify-center", turn && "rotate-90")}>
          <Icon className="size-3.5" aria-hidden />
        </span>
      ) : null}
      <span className="flex-1">{label}</span>
      {checked ? <Check className="size-3.5 text-foreground" aria-hidden /> : null}
    </DropdownMenuItem>
  );
}

/** Groups after the size row (Flex, Grid, Grid child, Padding, Margin) sit 16px apart, as in Wonder 05/06. */
const GROUP = "mt-2";

/* ---------- Display + size ---------- */
const DISPLAY = [
  { value: "free", label: "Free position", icon: FreeLayoutIcon },
  { value: "flex", label: "Flexbox", icon: FlexLayoutIcon },
  { value: "block", label: "Block flow", icon: BlockLayoutIcon },
  { value: "grid", label: "Grid", icon: GridLayoutIcon },
];

/** What the W/H menu offers: the stored modes plus Relative (a Fixed size kept as a % of the parent: wPct / hPct). */
type SizeChoice = SizingMode | "relative";
const SIZE: Record<SizeChoice, { label: string; unit: string; icon: IconType; turn?: boolean }> = {
  fixed: { label: "Fixed", unit: "px", icon: SizeFixedIcon, turn: true },
  relative: { label: "Relative", unit: "%", icon: CirclePercent },
  hug: { label: "Hug", unit: "Hug", icon: SizeHugIcon, turn: true },
  fill: { label: "Fill", unit: "Fill", icon: MoveHorizontal, turn: true },
  auto: { label: "Auto", unit: "Auto", icon: SizeAutoIcon },
  calc: { label: "Calculate", unit: "", icon: SizeCalcIcon },
};
const ORDER: SizeChoice[] = ["fixed", "relative", "hug", "fill", "auto", "calc"];
const AXIS_KEYS = {
  w: { mode: "wMode", pct: "wPct", calc: "wCalc", name: "width" },
  h: { mode: "hMode", pct: "hPct", calc: "hCalc", name: "height" },
} as const;

function choiceOf(node: Node, axis: "w" | "h", parent: Node | undefined): SizeChoice {
  const mode = sizingMode(node, axis, parent);
  return mode === "fixed" && parent && node[AXIS_KEYS[axis].pct] !== undefined ? "relative" : mode;
}

/**
 * Modes listed in the axis menu; unavailable ones are omitted, not disabled (Wonder B2): a top-level frame offers
 * Fixed and Calculate, a top-level text adds Hug and Auto, a child adds Relative and (in a flow parent) Fill.
 */
function sizeChoices(node: Node, parent: Node | undefined, current: SizeChoice): SizeChoice[] {
  const allowed: Record<SizeChoice, boolean> = {
    fixed: true,
    relative: !!parent,
    hug: sizingAllowed(node, parent, "hug") && (node.type === "text" || !!parent),
    fill: sizingAllowed(node, parent, "fill"),
    auto: node.type === "text" || (node.type === "frame" && isFlow(parent)),
    calc: true,
  };
  return ORDER.filter((c) => allowed[c] || c === current);
}

/** The parent's size a percentage resolves against: its content box for flow children, padding box otherwise. */
function percentBase(node: Node, parent: Node, axis: "w" | "h"): number {
  const el = document.querySelector<HTMLElement>(`#canvas [data-id="${CSS.escape(parent.id)}"]`);
  if (!el) return num(parent[axis]);
  const style = getComputedStyle(el);
  const inner = axis === "w" ? el.clientWidth : el.clientHeight;
  const sides =
    axis === "w"
      ? [style.paddingLeft, style.paddingRight]
      : [style.paddingTop, style.paddingBottom];
  const flow = isFlow(parent) && node.position !== "absolute";
  return inner - (flow ? sides.reduce((sum, v) => sum + (parseFloat(v) || 0), 0) : 0);
}

/** The patch that switches one layer's axis to `choice`, keeping its current size where the mode stores one. */
function sizePatch(doc: DesignDocument, n: Node, axis: "w" | "h", choice: SizeChoice): Patch {
  const k = AXIS_KEYS[axis];
  const size = num(n[axis], 1);
  const base: Patch = { [k.pct]: undefined, [k.calc]: undefined };
  if (choice === "fixed") return { ...base, [k.mode]: "fixed", [axis]: Math.max(1, r2(size)) };
  if (choice === "relative") {
    const parent = parentOf(doc, n);
    const total = parent ? percentBase(n, parent, axis) : 0;
    return { ...base, [k.mode]: "fixed", [k.pct]: total > 0 ? r2((size / total) * 100) : 100 };
  }
  if (choice === "calc") return { ...base, [k.mode]: "calc", [k.calc]: fmt(size) + "px" };
  return { ...base, [k.mode]: choice };
}

/**
 * Commit typed W/H text. A number keeps the mode's meaning (px, or % in Relative); "50%" switches to Relative; an
 * expression ("100% - 24px") or any text in Calculate mode is a Calculate expression. Typing detaches a variable.
 */
function commitSize(
  doc: DesignDocument,
  selection: string[],
  node: Node,
  axis: "w" | "h",
  choice: SizeChoice,
  raw: string,
) {
  const k = AXIS_KEYS[axis];
  const text = raw.trim();
  const plain = /^-?\d*\.?\d+$/.test(text);
  const percent = /^-?\d*\.?\d+\s*%$/.test(text);
  if (plain && choice !== "relative" && choice !== "calc") {
    setField(selection, node, axis, text);
    return;
  }
  if ((plain && choice === "relative") || (percent && choice !== "calc")) {
    if (!parentOf(doc, node)) return void notify("A percentage needs a parent layer.");
    const v = parseFloat(text);
    if (!(v > 0)) return void notify("Enter a percentage above 0.");
    patchNodes(selection, (n) => ({
      [k.mode]: "fixed",
      [k.pct]: r2(v),
      [k.calc]: undefined,
      ...unbind(n, axis),
    }));
    return;
  }
  const parsed = calcApi().parseCalc(plain ? text + "px" : text);
  if (!parsed)
    return void notify("Enter a number, a percentage or an expression such as 100% - 24px.");
  if (parsed.pct && !parentOf(doc, node)) return void notify("A percentage needs a parent layer.");
  patchNodes(selection, (n) => ({
    [k.mode]: "calc",
    [k.calc]: parsed.text,
    [k.pct]: undefined,
    ...unbind(n, axis),
  }));
}

/** The limit glyphs turned a quarter for the height limits (Wonder B2-max-height-added). */
export const SizeMinHIcon = ({ className }: { className?: string }) => (
  <SizeMinIcon className={cn(className, "rotate-90")} aria-hidden />
);
const SizeMaxHIcon = ({ className }: { className?: string }) => (
  <SizeMaxIcon className={cn(className, "rotate-90")} aria-hidden />
);
const LIMITS = [
  { key: "minW", axis: "w", label: "Min width", short: "Min W", icon: SizeMinIcon },
  { key: "maxW", axis: "w", label: "Max width", short: "Max W", icon: SizeMaxIcon },
  { key: "minH", axis: "h", label: "Min height", short: "Min H", icon: SizeMinHIcon },
  { key: "maxH", axis: "h", label: "Max height", short: "Max H", icon: SizeMaxHIcon },
] as const;
type LimitKey = (typeof LIMITS)[number]["key"];
const hasLimit = (node: Node, key: LimitKey) => node[key] !== undefined && node[key] !== null;
/** Focus a newly inserted limit field (Wonder inserts the empty row focused); retries until React has rendered it. */
const focusLimit = (key: LimitKey, tries = 5) =>
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLInputElement>(`#layout-section input[name=${key}]`);
    if (input) input.focus();
    else if (tries > 1) focusLimit(key, tries - 1);
  });

function SizeField({
  doc,
  node,
  parent,
  axis,
  selection,
  pending,
  onAddLimit,
}: Props & {
  parent: Node | undefined;
  axis: "w" | "h";
  pending: LimitKey[];
  onAddLimit: (key: LimitKey) => void;
}) {
  const choice = choiceOf(node, axis, parent);
  const label = axis === "w" ? "Width" : "Height";
  const k = AXIS_KEYS[axis];
  const value =
    choice === "relative"
      ? fmt(node[k.pct])
      : choice === "calc"
        ? String(node[k.calc] ?? "")
        : fmt(node[axis]);
  const limits = LIMITS.filter(
    (l) => l.axis === axis && !hasLimit(node, l.key) && !pending.includes(l.key),
  );
  const added = useRef<LimitKey | null>(null);
  // Wonder A9 multi-select: W/H read "Mixed" (no unit, chevron only) when the selected layers differ.
  const wanted = new Set(selection);
  const mixed =
    selection.length > 1 &&
    new Set(
      pageNodes(doc)
        .filter((n) => wanted.has(n.id))
        .map((n) => {
          const c = choiceOf(n, axis, parentOf(doc, n));
          const v =
            c === "relative"
              ? fmt(n[k.pct])
              : c === "calc"
                ? String(n[k.calc] ?? "")
                : fmt(n[axis]);
          return c + ":" + v;
        }),
    ).size > 1;
  // A Dimension variable can drive a fixed width/height; binding switches the axis to fixed.
  return (
    <BindableField
      doc={doc}
      node={node}
      selection={selection}
      field={axis}
      label={label}
      prefix={<Affix>{axis.toUpperCase()}</Affix>}
      typeBind="typing"
    >
      {(bind) => (
        <Field
          name={axis}
          label={label}
          numeric={choice !== "calc"}
          scrub={choice !== "calc"}
          value={mixed ? "" : value}
          placeholder={mixed ? "Mixed" : undefined}
          onCommit={(raw) => commitSize(doc, selection, node, axis, choice, raw)}
          prefix={<Affix>{axis.toUpperCase()}</Affix>}
          className="pr-1 has-aria-expanded:ring-1 has-aria-expanded:ring-ring"
          suffix={
            <>
              {/* The variable diamond floats left of the unit so the unit sits where Wonder draws it. */}
              <span className="relative -mr-1 w-0 self-stretch">
                <span className="absolute inset-y-0 right-0.5 flex items-center">{bind}</span>
              </span>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <UnitTrigger
                    label={label + " sizing"}
                    unit={mixed ? "" : SIZE[choice].unit}
                    data-size-menu={axis}
                    data-mixed={mixed || undefined}
                    data-mode={choice}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  alignOffset={-4}
                  sideOffset={8}
                  className="w-38"
                  onCloseAutoFocus={(event) => {
                    // The new limit row already has focus: don't hand it back to the trigger.
                    if (!added.current) return;
                    event.preventDefault();
                    added.current = null;
                  }}
                >
                  {sizeChoices(node, parent, choice).map((c) => (
                    <MenuChoice
                      key={c}
                      data-size-mode={c}
                      icon={SIZE[c].icon}
                      turn={axis === "h" && SIZE[c].turn}
                      label={SIZE[c].label}
                      checked={c === choice}
                      onSelect={() =>
                        c !== choice && patchNodes(selection, (n) => sizePatch(doc, n, axis, c))
                      }
                    />
                  ))}
                  {limits.length ? <DropdownMenuSeparator /> : null}
                  {limits.map((l) => (
                    <MenuChoice
                      key={l.key}
                      data-limit={l.key}
                      icon={l.icon}
                      label={"Add " + l.label.toLowerCase()}
                      onSelect={() => {
                        added.current = l.key;
                        onAddLimit(l.key);
                        focusLimit(l.key);
                      }}
                    />
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />
      )}
    </BindableField>
  );
}

/**
 * One row per min/max limit: Wonder's "Add min width" inserts an empty, focused "⟷ Min W ▾" row (pending until a
 * value is typed); a set limit shows its value with the kind menu (switch kind, remove) on the chevron.
 */
function LimitRows({
  doc,
  node,
  selection,
  pending,
  onPendingChange,
}: Props & { pending: LimitKey[]; onPendingChange: (next: LimitKey[]) => void }) {
  const rows = LIMITS.filter((l) => hasLimit(node, l.key) || pending.includes(l.key));
  if (!rows.length) return null;
  const drop = (key: LimitKey) => onPendingChange(pending.filter((p) => p !== key));
  return (
    <>
      {rows.map((l) => {
        const set = hasLimit(node, l.key);
        const value = set ? String(node[l.key] as number | string) : "";
        const icon = l.icon;
        const others = LIMITS.filter((o) => o.key !== l.key && !hasLimit(node, o.key));
        const switchTo = (next: LimitKey) => {
          if (!set) {
            onPendingChange([...pending.filter((p) => p !== l.key && p !== next), next]);
            focusLimit(next);
            return;
          }
          // Switching the limit kind carries its value and variable along.
          patchNodes(selection, (n) => {
            const bound = n.bindings?.[l.key];
            const rest = unbind(n, l.key);
            const bindings = bound
              ? { bindings: { ...(rest.bindings ?? n.bindings), [next]: bound } }
              : rest;
            return { [l.key]: undefined, [next]: n[l.key], ...bindings };
          });
        };
        const remove = () => {
          drop(l.key);
          if (set) patchNodes(selection, (n) => ({ [l.key]: undefined, ...unbind(n, l.key) }));
        };
        return (
          <Row key={l.key}>
            <BindableField
              doc={doc}
              node={node}
              selection={selection}
              field={l.key}
              label={l.label}
              prefix={<IconAffix icon={icon} />}
              className="col-span-2"
              typeBind="empty"
            >
              {(bind) => (
                <Field
                  name={l.key}
                  label={l.label}
                  numeric={!value.endsWith("%")}
                  value={value}
                  placeholder={l.short}
                  className="col-span-2 pr-1 has-aria-expanded:ring-1 has-aria-expanded:ring-ring"
                  prefix={<IconAffix icon={icon} />}
                  onCommit={(raw) => {
                    if (raw.trim() === "") return remove();
                    const pct = /^\s*\d+(\.\d+)?%\s*$/.test(raw) ? raw.trim() : null;
                    const v = pct ?? parseLength(raw, 0);
                    if (v === null) return;
                    // Typing a limit detaches its variable.
                    patchNodes(selection, (n) => ({ [l.key]: v, ...unbind(n, l.key) }));
                    drop(l.key);
                  }}
                  suffix={
                    <>
                      <span className="relative -mr-1 w-0 self-stretch">
                        <span className="absolute inset-y-0 right-0.5 flex items-center">
                          {bind}
                        </span>
                      </span>
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <UnitTrigger
                            label={l.label + " limit"}
                            unit={set ? l.short : ""}
                            data-limit-menu={l.key}
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          alignOffset={-4}
                          sideOffset={8}
                          className="w-38"
                        >
                          <MenuChoice
                            data-limit-kind={l.key}
                            icon={l.icon}
                            label={l.label}
                            checked
                            onSelect={() => undefined}
                          />
                          {others.map((o) => (
                            <MenuChoice
                              key={o.key}
                              data-limit-kind={o.key}
                              icon={o.icon}
                              label={o.label}
                              onSelect={() => switchTo(o.key)}
                            />
                          ))}
                          <DropdownMenuSeparator />
                          <MenuChoice data-limit-remove={l.key} label="Remove" onSelect={remove} />
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  }
                />
              )}
            </BindableField>
          </Row>
        );
      })}
    </>
  );
}

/* ---------- Alignment matrix ---------- */
const AXIS = ["start", "center", "end"] as const;
const JUSTIFY_AT = ["flex-start", "center", "flex-end"];
const indexOf = (value: unknown) =>
  value === "center" ? 1 : value === "flex-end" || value === "end" ? 2 : 0;
const DISTRIBUTED = ["space-around", "space-between", "space-evenly"];
const EDGE = ["items-start", "items-center", "items-end"];
const EDGE_X = ["justify-start", "justify-center", "justify-end"];
const CELL_Y = ["top", "center", "bottom"];
const CELL_X = ["left", "center", "right"];
/** Wonder's cell tooltip (H9-hover-verified: "Align bottom right"); the middle cell reads "Align center". */
const cellTip = (row: number, col: number) =>
  row === 1 && col === 1 ? "Align center" : `Align ${CELL_Y[row]} ${CELL_X[col]}`;

/**
 * Wonder's active-cell glyph (C3): three 2px bars 2px apart along the main axis, the middle one longer (6 / 10 / 6),
 * aligned on the cross axis; all three full length when stretched.
 */
function Bars({ column, cross, stretch }: { column: boolean; cross: number; stretch: boolean }) {
  const outer = column ? (stretch ? "w-2.5" : "w-1.5") : stretch ? "h-2.5" : "h-1.5";
  const bar = cn("rounded-full bg-primary", column ? "h-0.5" : "w-0.5");
  return (
    <span
      aria-hidden
      className={cn(
        "flex gap-0.5",
        column ? "flex-col" : "flex-row",
        cross === 1 ? "items-center" : cross === 2 ? "items-end" : "items-start",
      )}
    >
      <span className={cn(bar, outer)} />
      <span className={cn(bar, column ? "w-2.5" : "h-2.5")} />
      <span className={cn(bar, outer)} />
    </span>
  );
}

function Matrix({
  label,
  isActive,
  glyph,
  place,
  onPick,
  className,
}: {
  label: string;
  isActive: (row: number, col: number) => boolean;
  glyph: ReactNode;
  /** Where the active glyph sits in its cell (default: centred). */
  place?: (row: number, col: number) => string;
  onPick: (row: number, col: number) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        // 3px inset (Wonder G4): 34px columns centred at x 20 / 54 / 88, and edge-cell bars 3px from the well's edge.
        "grid h-14 grid-cols-3 grid-rows-3 rounded-md bg-input p-0.75 shadow-field",
        className,
      )}
    >
      {[0, 1, 2].map((row) =>
        [0, 1, 2].map((col) => {
          const active = isActive(row, col);
          return (
            <Tip key={row + "-" + col} label={cellTip(row, col)}>
              <button
                type="button"
                data-cell={row + "-" + col}
                aria-label={`${label}: ${AXIS[row]} ${AXIS[col]}`}
                aria-pressed={active}
                className={cn(
                  // Dots sit at the cell centres; the hovered cell shows Wonder's #363636 box (C3-flex-align-center).
                  "group/cell flex rounded-sm outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring",
                  active && place ? place(row, col) : "items-center justify-center",
                )}
                onClick={() => onPick(row, col)}
              >
                {active ? (
                  glyph
                ) : (
                  <span className="size-0.5 rounded-full bg-muted-foreground group-hover/cell:bg-foreground" />
                )}
              </button>
            </Tip>
          );
        }),
      )}
    </div>
  );
}

/** Space-around / between / evenly; pressing the active mode returns to packed alignment. */
function Distribution({
  value,
  column,
  onChange,
}: {
  value: string;
  column: boolean;
  onChange: (value: string) => void;
}) {
  const items = [
    {
      value: "space-around",
      label: "Space around",
      icon: column ? DistributeAroundYIcon : DistributeAroundXIcon,
    },
    {
      value: "space-between",
      label: "Space between",
      icon: column ? DistributeBetweenYIcon : DistributeBetweenXIcon,
    },
    {
      value: "space-evenly",
      label: "Space evenly",
      icon: column ? DistributeEvenlyYIcon : DistributeEvenlyXIcon,
    },
  ];
  return (
    <Segmented
      label="Distribution"
      hook="insp-distribution"
      dataKey="distribute"
      deselectable
      value={DISTRIBUTED.includes(value) ? value : ""}
      onChange={onChange}
      items={items}
      itemClassName="text-muted-foreground"
    />
  );
}

/* ---------- Gaps ---------- */
/**
 * Gap fields on physical axes (`]|[` column gap, `≍` row gap). The main-axis field edits `gap` (bindable to a
 * variable) and clears that axis' override; the cross-axis field edits its own override (`gapX` / `gapY`) and is
 * always editable (Wonder B1: it only shows on the canvas once the stack wraps). Committing the main gap pins an
 * unset cross gap to the old value, so the cross field never follows the main one.
 */
function GapField({
  doc,
  node,
  selection,
  axis,
  main,
  className,
}: Props & { axis: "x" | "y"; main: boolean; className?: string }) {
  const key = axis === "x" ? "gapX" : "gapY";
  const cross = axis === "x" ? "gapY" : "gapX";
  const value = num(node[key], num(node.gap));
  const icon = axis === "x" ? GapXIcon : GapYIcon;
  const label = axis === "x" ? "Column gap" : "Row gap";
  const commit = (raw: string) => {
    const v = parseLength(raw, 0);
    if (v === null) return;
    patchNodes(selection, (n) => {
      if (!main) return { [key]: v };
      const pin = n[cross] === undefined && num(n.gap) !== v ? { [cross]: num(n.gap) } : {};
      return { gap: v, [key]: undefined, ...pin, ...unbind(n, "gap") };
    });
  };
  if (!main)
    return (
      <NumberField
        name={key}
        label={label}
        icon={icon}
        value={fmt(value)}
        className={className}
        onCommit={commit}
      />
    );
  return (
    <div className={cn("min-w-0", className)}>
      <BindableField
        doc={doc}
        node={node}
        selection={selection}
        field="gap"
        label={label}
        prefix={<IconAffix icon={icon} />}
        typeBind="typing"
      >
        {(suffix) => (
          <Field
            name="gap"
            label={label}
            numeric
            value={fmt(value)}
            onCommit={commit}
            prefix={<IconAffix icon={icon} />}
            suffix={suffix}
          />
        )}
      </BindableField>
    </div>
  );
}

/* ---------- Flex ---------- */
const DIRECTION = [
  { value: "row", label: "Horizontal", icon: ColumnsIcon },
  { value: "column", label: "Vertical", icon: RowsIcon },
];
/** Active flex toggles (baseline, reverse, wrap) take Wonder's purple tint (C3-flex-wrap-on). */
const TOGGLE = "data-active:bg-toggle-active data-active:text-toggle-active-foreground";

function FlexGroup(props: Props) {
  const { node, selection } = props;
  const column = node.direction === "column";
  const reverse = node.reverse === true;
  const wrap = !!node.flexWrap;
  const baseline = !column && node.alignItems === "baseline";
  const distributed = DISTRIBUTED.includes(node.justifyContent);
  // Visual main-axis position (reverse flips which edge flex-start is on).
  const mainOf = (justify: unknown) => {
    const i = indexOf(justify);
    return reverse ? 2 - i : i;
  };
  const cross = indexOf(node.alignItems);
  const set = (patch: Patch) => patchNodes(selection, () => patch);
  return (
    <Caption label="Flex" className={GROUP}>
      <div className="flex items-start gap-2">
        <div className="grid min-w-0 flex-1 grid-cols-2 grid-rows-3 gap-2">
          <Segmented
            label="Direction"
            hook="insp-direction"
            dataKey="direction"
            value={column ? "column" : "row"}
            onChange={(direction) => set({ direction })}
            items={DIRECTION}
            className="col-start-1 row-start-1"
          />
          <Matrix
            label="Alignment"
            className="col-start-2 row-span-2 row-start-1"
            isActive={(row, col) => {
              const [m, c] = column ? [row, col] : [col, row];
              return c === cross && (distributed || m === mainOf(node.justifyContent));
            }}
            glyph={<Bars column={column} cross={cross} stretch={node.alignItems === "stretch"} />}
            // The glyph is centred along the main axis and pushed to its cross-axis edge.
            place={(row, col) =>
              column ? cn("items-center", EDGE_X[col]) : cn("justify-center", EDGE[row])
            }
            onPick={(row, col) => {
              const [m, c] = column ? [row, col] : [col, row];
              const patch: Patch = { alignItems: JUSTIFY_AT[c] };
              if (!distributed) patch.justifyContent = JUSTIFY_AT[reverse ? 2 - m : m];
              set(patch);
            }}
          />
          <GapField {...props} axis="x" main={!column} className="col-start-1 row-start-2" />
          <GapField {...props} axis="y" main={column} className="col-start-1 row-start-3" />
          <div className="col-start-2 row-start-3">
            <Distribution
              value={node.justifyContent}
              column={column}
              onChange={(v) => set({ justifyContent: v || "flex-start" })}
            />
          </div>
        </div>
        {/* Wonder's trailing column: baseline (rows only), reverse, wrap. */}
        <div className="flex w-6 shrink-0 flex-col items-center gap-2">
          {column ? null : (
            <IconButton
              icon={ArrowDownToLine}
              label="Align to baseline"
              active={baseline}
              aria-pressed={baseline}
              className={TOGGLE}
              onClick={() => set({ alignItems: baseline ? "flex-start" : "baseline" })}
            />
          )}
          <IconButton
            icon={ArrowRightLeft}
            label="Reverse order"
            active={reverse}
            aria-pressed={reverse}
            className={TOGGLE}
            onClick={() => set({ reverse: reverse ? undefined : true })}
          />
          <IconButton
            icon={WrapIcon}
            label="Wrap"
            active={wrap}
            aria-pressed={wrap}
            className={TOGGLE}
            onClick={() => set({ flexWrap: wrap ? undefined : true })}
          />
        </div>
      </div>
    </Caption>
  );
}

/* ---------- Grid ---------- */
function GridGroup(props: Props) {
  const { node, selection } = props;
  const stretched = (v: unknown) => v === undefined || v === "stretch" || v === "normal";
  const free = stretched(node.alignItems) && stretched(node.justifyItems);
  const row = indexOf(node.alignItems),
    col = indexOf(node.justifyItems);
  return (
    <>
      <Row className={GROUP}>
        <Caption label="Grid">
          <GridPreview node={props.node} />
        </Caption>
        <Caption label="Gap">
          {/* Two stacked 24px fields, 8px apart, beside the 60px track preview (Wonder C4). */}
          <div className="flex flex-col gap-2">
            <GapField {...props} axis="x" main />
            <GapField {...props} axis="y" main={false} />
          </div>
        </Caption>
      </Row>
      <Row className={GROUP}>
        <Caption label="Align">
          <Matrix
            label="Cell alignment"
            isActive={(r, c) => !free && r === row && c === col}
            glyph={<span aria-hidden className="mx-0.5 size-1.5 rounded-xs bg-primary" />}
            onPick={(r, c) =>
              patchNodes(selection, () =>
                !free && r === row && c === col
                  ? { alignItems: "stretch", justifyItems: undefined }
                  : { alignItems: JUSTIFY_AT[r], justifyItems: JUSTIFY_AT[c] },
              )
            }
          />
        </Caption>
      </Row>
    </>
  );
}

/* ---------- Block ---------- */
const BLOCK_ALIGN = [
  { value: "flex-start", label: "Align left", icon: AlignStartVertical },
  { value: "center", label: "Align center", icon: AlignCenterVertical },
  { value: "flex-end", label: "Align right", icon: AlignEndVertical },
];

/**
 * Block flow (Wonder C2-display-block): vertical spacing, then a left / centre / right alignment of the children
 * (`justifyItems` on the frame; children narrower than the frame move, Fill children keep the full width).
 */
function BlockGroup({ node, selection }: Props) {
  const align =
    node.justifyItems === "center" || node.justifyItems === "flex-end"
      ? node.justifyItems
      : "flex-start";
  return (
    <Caption label="Block" className={GROUP}>
      <Row>
        <NumberField
          name="gapY"
          label="Vertical spacing"
          icon={GapYIcon}
          value={fmt(num(node.gapY))}
          onCommit={(raw) => {
            const v = parseLength(raw, 0);
            if (v !== null) patchNodes(selection, () => ({ gapY: v || undefined }));
          }}
        />
        <Segmented
          label="Block alignment"
          hook="insp-block-align"
          dataKey="align"
          value={align}
          onChange={(v) =>
            patchNodes(selection, () => ({ justifyItems: v === "flex-start" ? undefined : v }))
          }
          items={BLOCK_ALIGN}
          itemClassName="text-muted-foreground"
        />
      </Row>
    </Caption>
  );
}

/* ---------- Grid child ---------- */
function GridChild({ node, selection }: Props) {
  const span = (key: "colSpan" | "rowSpan") => (raw: string) => {
    const text = raw.trim().toLowerCase();
    if (text === "" || text === "1") return patchNodes(selection, () => ({ [key]: undefined }));
    if (key === "colSpan" && text === "full")
      return patchNodes(selection, () => ({ colSpan: "full" }));
    const v = parseLength(raw, 1);
    if (v !== null) patchNodes(selection, () => ({ [key]: Math.min(24, Math.round(v)) }));
  };
  return (
    <Caption label="Grid child" className={GROUP}>
      <Row>
        <NumberField
          name="colSpan"
          label="Column span"
          icon={ColumnsIcon}
          value={node.colSpan === "full" ? "Full" : String(node.colSpan ?? 1)}
          onCommit={span("colSpan")}
        />
        <NumberField
          name="rowSpan"
          label="Row span"
          icon={RowsIcon}
          value={String(node.rowSpan ?? 1)}
          onCommit={span("rowSpan")}
        />
      </Row>
    </Caption>
  );
}

/* ---------- Padding ---------- */
/** Wonder's neutral active toggle (C6-padding-expanded): #262626 behind a bright glyph. */
const NEUTRAL = "data-active:bg-muted";
const PAD_KEYS = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"] as const;
const padsOf = (n: Node) => PAD_KEYS.map((k) => num(n[k], num(n.padding)));

function PaddingGroup({ doc, node, selection }: Props) {
  const [t, r, b, l] = padsOf(node);
  const [split, setSplit] = useState(() => t !== b || l !== r);
  // Sides are [top, right, bottom, left]; equal sides collapse back to the single `padding` value.
  // Typing a side detaches the uniform binding and the axis binding that drove that side.
  const edit = (sides: number[]) => (raw: string) => {
    const v = parseLength(raw, 0);
    if (v === null) return;
    patchNodes(selection, (n) => {
      const next = padsOf(n).map((p, i) => (sides.includes(i) ? v : p));
      const binding = unbind(
        n,
        "padding",
        ...(sides.some((i) => i % 2) ? ["paddingX"] : []),
        ...(sides.some((i) => i % 2 === 0) ? ["paddingY"] : []),
      );
      return next.every((p) => p === next[0])
        ? {
            padding: next[0],
            ...Object.fromEntries(PAD_KEYS.map((k) => [k, undefined])),
            ...binding,
          }
        : { ...Object.fromEntries(PAD_KEYS.map((k, i) => [k, next[i]])), ...binding };
    });
  };
  const mixed = (a: number, z: number) => (a === z ? fmt(a) : "");
  const field = (name: string, label: string, icon: IconType, value: string, sides: number[]) => (
    <NumberField
      name={name}
      label={label}
      icon={icon}
      value={value}
      placeholder="Mixed"
      unit="px"
      onCommit={edit(sides)}
    />
  );
  // Horizontal / vertical padding each bind a Dimension (Wonder 06); a uniform `padding` binding from
  // older files still renders as one chip.
  const axisField = (
    key: "paddingX" | "paddingY",
    label: string,
    icon: IconType,
    value: string,
    sides: number[],
  ) => (
    <BindableField
      doc={doc}
      node={node}
      selection={selection}
      field={key}
      label={label}
      prefix={<IconAffix icon={icon} />}
    >
      {(suffix) => (
        <NumberField
          name={key}
          label={label}
          icon={icon}
          value={value}
          placeholder="Mixed"
          unit={<>px{suffix}</>}
          onCommit={edit(sides)}
        />
      )}
    </BindableField>
  );
  const horizontal = axisField("paddingX", "Horizontal padding", PaddingXIcon, mixed(l, r), [1, 3]);
  const bound = !!node.bindings?.padding;
  return (
    <Caption label="Padding" className={GROUP}>
      <Row
        tool={
          <IconButton
            icon={PaddingSidesIcon}
            label="Independent padding"
            className={NEUTRAL}
            active={split}
            aria-pressed={split}
            onClick={() => setSplit(!split)}
          />
        }
      >
        {split && !bound ? (
          <>
            {field("paddingLeft", "Left padding", PaddingLeftIcon, fmt(l), [3])}
            {field("paddingTop", "Top padding", PaddingTopIcon, fmt(t), [0])}
            {field("paddingRight", "Right padding", PaddingRightIcon, fmt(r), [1])}
            {field("paddingBottom", "Bottom padding", PaddingBottomIcon, fmt(b), [2])}
          </>
        ) : bound ? (
          <div className="col-span-2">
            <BindableField
              doc={doc}
              node={node}
              selection={selection}
              field="padding"
              label="Padding"
              prefix={<IconAffix icon={PaddingXIcon} />}
            >
              {() => null}
            </BindableField>
          </div>
        ) : (
          <>
            {horizontal}
            {axisField("paddingY", "Vertical padding", PaddingYIcon, mixed(t, b), [0, 2])}
          </>
        )}
      </Row>
    </Caption>
  );
}

/* ---------- Margin (layers placed by a flow parent) ---------- */
const marginOf = (n: Node): Side[] =>
  Array.isArray(n.margin) && n.margin.length === 4
    ? (n.margin as unknown[]).map((v) => (v === "auto" ? "auto" : num(v)))
    : [0, 0, 0, 0];

function MarginGroup({ node, selection }: Props) {
  const m = marginOf(node);
  const [split, setSplit] = useState(() => m[1] !== m[3] || m[0] !== m[2]);
  const write = (sides: number[], v: Side) =>
    patchNodes(selection, (n) => {
      const next = marginOf(n).map((s, i) => (sides.includes(i) ? v : s));
      return { margin: next.every((s) => s === 0) ? undefined : next };
    });
  const field = (name: string, label: string, icon: IconType, sides: number[]) => {
    const values = sides.map((i) => m[i]);
    const same = values.every((v) => v === values[0]);
    const auto = same && values[0] === "auto";
    return (
      <NumberField
        name={name}
        label={label}
        icon={icon}
        value={!same ? "" : auto ? "Auto" : fmt(values[0])}
        placeholder="Mixed"
        onCommit={(raw) => {
          if (/^\s*auto\s*$/i.test(raw)) return write(sides, "auto");
          const v = parseLength(raw);
          if (v !== null) write(sides, v);
        }}
        unit={
          // Wonder C7: "px ▾" / "Auto ▾" opens Fixed / Auto (24px rows, ✓ on the current one).
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <UnitTrigger
                label={label + " unit"}
                unit={auto ? "Auto" : "px"}
                data-unit-menu={name}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" alignOffset={-8} sideOffset={8} className="w-38">
              <MenuChoice
                data-unit="px"
                label="Fixed"
                checked={!auto}
                onSelect={() => auto && write(sides, 0)}
              />
              <MenuChoice
                data-unit="auto"
                label="Auto"
                checked={auto}
                onSelect={() => !auto && write(sides, "auto")}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
    );
  };
  return (
    <Caption label="Margin" className={GROUP}>
      <Row
        tool={
          <IconButton
            icon={MarginSidesIcon}
            label="Independent margins"
            className={NEUTRAL}
            active={split}
            aria-pressed={split}
            onClick={() => setSplit(!split)}
          />
        }
      >
        {split ? (
          <>
            {field("marginLeft", "Left margin", MarginLeftIcon, [3])}
            {field("marginTop", "Top margin", MarginTopIcon, [0])}
            {field("marginRight", "Right margin", MarginRightIcon, [1])}
            {field("marginBottom", "Bottom margin", MarginBottomIcon, [2])}
          </>
        ) : (
          <>
            {field("marginX", "Horizontal margin", MarginXIcon, [1, 3])}
            {field("marginY", "Vertical margin", MarginYIcon, [0, 2])}
          </>
        )}
      </Row>
    </Caption>
  );
}

/* ---------- Section ---------- */
export function LayoutSection(props: Props) {
  const { doc, node, selection } = props;
  const parent = parentOf(doc, node);
  const frame = node.type === "frame";
  const layout = node.layout === "inline" ? "block" : node.layout;
  const flow = frame && node.layout !== "free";
  const inFlow = isFlow(parent) && node.position !== "absolute";
  // Limit rows added from a W/H menu but not typed yet (Wonder shows them empty and focused).
  const [pendingLimits, setPendingLimits] = useState<{ id: string; keys: LimitKey[] }>({
    id: node.id,
    keys: [],
  });
  const pending = pendingLimits.id === node.id ? pendingLimits.keys : [];
  const setPending = (keys: LimitKey[]) => setPendingLimits({ id: node.id, keys });
  const sizeProps = {
    ...props,
    parent,
    pending,
    onAddLimit: (key: LimitKey) => setPending([...pending.filter((k) => k !== key), key]),
  };
  const canHug = sizingAllowed(node, parent, "hug");
  return (
    <Section
      id="layout-section"
      title="Layout"
      tools={
        frame ? (
          <div className="flex items-center gap-2.5">
            {layout === "grid" ? <GridHeaderTools node={node} selection={selection} /> : null}
            {/* Wonder keeps this a quiet glyph without a fill in both states (05, 06, 14). */}
            <IconButton
              icon={AutoLayoutIcon}
              label={flow ? "Remove auto layout" : "Add auto layout"}
              aria-pressed={flow}
              className="text-subtle-foreground"
              onClick={() => setField(selection, node, "layout", flow ? "free" : "flex")}
            />
          </div>
        ) : null
      }
    >
      {frame ? (
        <Caption label="Display">
          <Segmented
            label="Display"
            hook="insp-display"
            dataKey="layout"
            value={layout}
            onChange={(value) => setField(selection, node, "layout", value)}
            items={DISPLAY}
          />
        </Caption>
      ) : null}
      <Row
        tool={
          // Wonder's trailing W/H glyph; here it fits the layer to its content (Hug on both axes).
          <IconButton
            icon={SizeOptionsIcon}
            label="Hug contents"
            disabled={!canHug}
            onClick={() =>
              patchNodes([node.id], () => ({
                ...sizePatch(doc, node, "w", "hug"),
                ...sizePatch(doc, node, "h", "hug"),
              }))
            }
          />
        }
      >
        <SizeField {...sizeProps} axis="w" />
        <SizeField {...sizeProps} axis="h" />
      </Row>
      <LimitRows {...props} pending={pending} onPendingChange={setPending} />
      {frame && node.layout === "flex" ? <FlexGroup {...props} /> : null}
      {frame && node.layout === "grid" ? <GridGroup {...props} /> : null}
      {frame && node.layout === "block" ? <BlockGroup {...props} /> : null}
      {inFlow && parent?.layout === "grid" ? <GridChild {...props} /> : null}
      {/* Sibling keys must differ: a shared key makes React keep stale copies when the groups above change. */}
      {flow ? <PaddingGroup key={"padding-" + node.id} {...props} /> : null}
      {inFlow ? <MarginGroup key={"margin-" + node.id} {...props} /> : null}
    </Section>
  );
}
