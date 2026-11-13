// Effects inspector: blend mode menu, Outline section, border style, and the shared pieces used by the
// Shadow / Filters / Mask lists (shadows.tsx, filters.tsx, masks.tsx). Data model and CSS mapping live in
// web/node-style.js (effectsOf / validateEffects), so the canvas, HTML export and JSX codec agree.
import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Check, Droplet, Eye, Unlink } from "lucide-react";
import {
  ClosedEyeIcon,
  OutlineOffsetIcon,
  PlusIcon,
  RemoveIcon,
  SlidersIcon,
  StrokeWeightIcon,
} from "@/components/icons";
import { type DesignDocument } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Field,
  fieldShell,
  IconAffix,
  IconButton,
  OptionalSection,
  Swatch,
  useHookClass,
} from "./controls";
import { ColorPopover } from "./color-picker";
import { VariableChip } from "./bind";
import { alphaPercent, withAlpha } from "./color";
import { fmt, hexLabel, parseHex, patchNodes, type Node } from "./model";

/* ---------- Model ---------- */
export type ShadowType = "box" | "drop" | "text";
export type Shadow = {
  type: ShadowType;
  inset?: boolean;
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  token?: string;
  hidden?: boolean;
};
export type FilterType =
  | "blur"
  | "brightness"
  | "contrast"
  | "grayscale"
  | "hueRotate"
  | "invert"
  | "saturate"
  | "sepia";
export type Filter = { type: FilterType; value: number; backdrop?: boolean; hidden?: boolean };
export type MaskType = "linear" | "radial" | "conic" | "image" | "custom" | "shape";
export type Mask = {
  type: MaskType;
  rotation?: number;
  alpha?: number;
  invert?: boolean;
  hidden?: boolean;
  /** Image mask: embedded data URL. */
  src?: string;
  /** Custom mask: a CSS gradient. */
  css?: string;
  /** Shape mask ("Use as mask"): inset(T% R% B% L%) of the layer's box. */
  shape?: string;
  mode?: "auto" | "alpha" | "luminance";
  repeat?: string;
  x?: number;
  y?: number;
  size?: string;
  composite?: "add" | "subtract" | "intersect" | "exclude";
};
export type EffectNode = Node & {
  blendMode?: string;
  outlineWidth?: number;
  outlineOffset?: number;
  outlineColor?: string;
  outlineStyle?: string;
  outlineToken?: string;
  outlineHidden?: boolean;
  strokeStyle?: string;
  strokeHidden?: boolean;
  shadows?: Shadow[];
  filters?: Filter[];
  masks?: Mask[];
};
export type EffectProps = { doc: DesignDocument; node: Node; selection: string[] };
type ListKey = "shadows" | "filters" | "masks";

/** Read one of the effect lists of a layer (always an array). */
export function listOf<T>(node: Node, key: ListKey): T[] {
  const value = (node as EffectNode)[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Replace an effect list on the selection from the primary layer's list (validated, one undo step). */
export function editList<T>(
  selection: string[],
  node: Node,
  key: ListKey,
  edit: (list: T[]) => T[],
) {
  const next = edit(listOf<T>(node, key).map((item) => ({ ...item })));
  patchNodes(selection, () => ({ [key]: next.length ? next : undefined }));
}

/** Parse a numeric draft; returns the clamped number or an error message. */
export function readNumber(raw: string, min = -Infinity, max = Infinity): number | string {
  const value = Number(raw.trim());
  if (!raw.trim() || !Number.isFinite(value)) return "Enter a number.";
  return Math.min(max, Math.max(min, value));
}

/* ---------- Row tools (visibility + remove), as in Wonder's Fill/Shadow/Filter rows ---------- */
export function RowTools({
  label,
  hidden,
  onToggle,
  onRemove,
}: {
  label: string;
  hidden: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <>
      <IconButton
        icon={hidden ? ClosedEyeIcon : Eye}
        label={(hidden ? "Show " : "Hide ") + label}
        data-effect-tool="visibility"
        onClick={onToggle}
      />
      <IconButton
        icon={RemoveIcon}
        label={"Remove " + label}
        data-effect-tool="remove"
        onClick={onRemove}
      />
    </>
  );
}

/* ---------- Colour field: swatch + hex + "NN %" in one field, optional Colors variable binding ---------- */
/** A bare text input inside a shared field shell: commit on Enter/blur, Escape reverts, ArrowUp/Down ±1 (Shift ×10). */
function InlineInput({
  name,
  label,
  value,
  onCommit,
  numeric,
  className,
}: {
  name: string;
  label: string;
  value: string;
  onCommit: (value: string) => string | null | void;
  numeric?: boolean;
  className?: string;
}) {
  const [draft, setDraftState] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const setDraft = (next: string | null) => {
    draftRef.current = next;
    setDraftState(next);
  };
  const commit = () => {
    const next = draftRef.current;
    if (next === null) return;
    setDraft(null);
    if (next !== value) onCommit(next);
  };
  return (
    <input
      name={name}
      aria-label={label}
      title={label}
      value={draft ?? value}
      inputMode={numeric ? "decimal" : undefined}
      autoComplete="off"
      spellCheck={false}
      className={cn(
        "h-full min-w-0 truncate bg-transparent text-xs text-foreground outline-none",
        numeric && "tabular-nums",
        className,
      )}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setDraft(null);
          event.currentTarget.blur();
        } else if (numeric && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
          event.preventDefault();
          const base = Number(draftRef.current ?? value);
          if (!Number.isFinite(base)) return;
          setDraft(null);
          onCommit(String(base + (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1)));
        }
      }}
    />
  );
}

/**
 * Wonder's colour row (properties-audit A2/A3/A4): one field with a 14px swatch, the hex and the alpha as "NN %"
 * at its right end. Bound to a Colors variable it shows the variable chip instead, with an unlink button inside
 * the field that appears on hover. `row` is the panel variant (Border, Outline): the field is 192px wide (x 12–204)
 * and, while the picker is open, a full-width band replaces the focus ring.
 */
export function EffectColorField({
  name,
  label,
  value,
  onCommit,
  tokens,
  token,
  onToken,
  row,
}: {
  name: string;
  label: string;
  value: string;
  onCommit: (color: string) => void;
  tokens?: Record<string, string>;
  token?: string;
  onToken?: (name: string) => void;
  row?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const bound = token && tokens?.[token] ? tokens[token] : undefined;
  const color = bound ?? value;
  const swatch = (
    <button
      type="button"
      aria-label={"Pick " + label.toLowerCase()}
      aria-expanded={open}
      className="flex size-3.5 shrink-0 items-center justify-center rounded-sm focus-visible:ring-1 focus-visible:ring-ring"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => setOpen(!open)}
    >
      <Swatch color={color} className="size-3.5" />
    </button>
  );
  const shell = cn(
    fieldShell,
    "gap-1 pl-1.5",
    row ? "w-48 shrink-0" : "flex-1",
    open && "focus-within:ring-0",
  );
  return (
    <ColorPopover
      open={open}
      onOpenChange={setOpen}
      value={color}
      onCommit={onCommit}
      tokens={tokens}
      token={token}
      onToken={onToken}
    >
      <div
        data-color-anchor
        data-color-open={open || undefined}
        className={cn(
          "flex min-w-0 items-center",
          row ? "-mx-3 -my-1 px-3 py-1" : "flex-1",
          row && open && "bg-input",
        )}
      >
        {bound && token ? (
          // Bound: swatch + variable chip, no hex or alpha; the chip opens the Variables tab.
          <div data-bound-color={name} className={cn(shell, "pr-1.5")}>
            {swatch}
            <button
              type="button"
              aria-label={`${label} variable ${token}`}
              title={`${token} = ${bound}`}
              className="flex h-5 min-w-0 items-center rounded-sm text-left focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => setOpen(!open)}
            >
              <VariableChip name={token} />
            </button>
            <span className="flex-1" />
            <button
              type="button"
              aria-label={`Detach ${label.toLowerCase()} variable`}
              title="Detach variable"
              data-detach-token={token}
              className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring group-hover/field:opacity-100"
              onClick={() => onCommit(bound)}
            >
              <Unlink className="size-3.5" aria-hidden />
            </button>
          </div>
        ) : (
          <div data-field-shell className={shell}>
            {swatch}
            <InlineInput
              name={name}
              label={label}
              value={hexLabel(value)}
              className="flex-1 uppercase"
              onCommit={(raw) => {
                const hex = parseHex(raw, value);
                if (!hex) return "Use a hex colour such as A58BDD";
                onCommit(hex);
              }}
            />
            <InlineInput
              name={name + "Alpha"}
              label={label + " opacity"}
              numeric
              value={String(alphaPercent(color))}
              className="w-6.5 shrink-0 text-right"
              onCommit={(raw) => {
                const next = withAlpha(value, Number(raw));
                if (!next || !raw.trim() || !Number.isFinite(Number(raw)))
                  return "Enter a percentage";
                onCommit(next);
              }}
            />
            <span data-field-suffix className="shrink-0 select-none text-muted-foreground">
              %
            </span>
          </div>
        )}
      </div>
    </ColorPopover>
  );
}

/* ---------- Blend mode (Appearance tool) ---------- */
// Wonder's order (design/wonder/2026-10-30/27): normal, darken group, lighten group, contrast group,
// difference group, component group.
export const BLEND_GROUPS: [string, string][][] = [
  [["normal", "Normal"]],
  [
    ["darken", "Darken"],
    ["multiply", "Multiply"],
    ["plus-darker", "Plus darker"],
    ["color-burn", "Color burn"],
  ],
  [
    ["lighten", "Lighten"],
    ["screen", "Screen"],
    ["plus-lighter", "Plus lighter"],
    ["color-dodge", "Color dodge"],
  ],
  [
    ["overlay", "Overlay"],
    ["soft-light", "Soft light"],
    ["hard-light", "Hard light"],
  ],
  [
    ["difference", "Difference"],
    ["exclusion", "Exclusion"],
  ],
  [
    ["hue", "Hue"],
    ["saturation", "Saturation"],
    ["color", "Color"],
    ["luminosity", "Luminosity"],
  ],
];

export function BlendMenu({ node, selection }: EffectProps) {
  const current = (node as EffectNode).blendMode || "normal";
  const label = BLEND_GROUPS.flat().find(([value]) => value === current)?.[1] ?? "Normal";
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <IconButton
          id="blend-mode"
          icon={Droplet}
          label={`Blend mode: ${label}`}
          active={current !== "normal"}
          data-blend-mode={current}
        />
      </DropdownMenuTrigger>
      {/* Wonder A11: below the drop, right-aligned (x 116–268, 152 wide), no title, 24 px items, scrolls when the
          window is short (the shared content caps it at the available height). No focus ring is handed back to the
          drop after a pointer pick. */}
      <DropdownMenuContent
        side="bottom"
        align="end"
        sideOffset={4}
        avoidCollisions={false}
        className="w-38 min-w-0"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {BLEND_GROUPS.map((group, index) => (
          <div key={group[0][0]} role="group">
            {index ? <DropdownMenuSeparator /> : null}
            {group.map(([value, text]) => (
              <DropdownMenuItem
                key={value}
                data-blend={value}
                className="h-6"
                onSelect={() =>
                  patchNodes(selection, () => ({
                    blendMode: value === "normal" ? undefined : value,
                  }))
                }
              >
                <span className="flex-1">{text}</span>
                {value === current ? <Check className="size-3.5" aria-hidden /> : null}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ---------- Line style menu (Border / Outline header sliders: Solid / Dashed / Dotted) ---------- */
const LINE_STYLES = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
];

/** Wonder's sliders tool: a 152px menu under the header, right-aligned to the tool, 24px items with a ✓. */
export function LineStyleMenu({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  /** `data-line-style-menu` hook (strokeStyle / outlineStyle). */
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const current = LINE_STYLES.some((s) => s.value === value) ? value : "solid";
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <IconButton
          icon={SlidersIcon}
          label={label}
          data-line-style-menu={name}
          data-line-style={current}
          // Wonder keeps the sliders tool filled while its menu is open.
          className="data-[state=open]:bg-accent data-[state=open]:text-foreground"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4} className="w-38 min-w-0">
        {LINE_STYLES.map((style) => (
          <DropdownMenuItem
            key={style.value}
            data-line-style-option={style.value}
            className="h-6"
            onSelect={() => onChange(style.value)}
          >
            <span className="flex-1">{style.label}</span>
            {style.value === current ? <Check className="size-3.5" aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ---------- Outline (a real CSS outline: width, offset, colour, style) ---------- */
export function OutlineSection({ doc, node, selection }: EffectProps) {
  const n = node as EffectNode;
  const width = typeof n.outlineWidth === "number" ? n.outlineWidth : 0;
  const hidden = n.outlineHidden === true;
  const color = n.outlineColor || "#000000";
  const patch = (values: Partial<EffectNode>) =>
    patchNodes(selection, (current) => {
      const c = current as EffectNode;
      return {
        outlineColor: c.outlineColor ?? color,
        outlineOffset: c.outlineOffset ?? n.outlineOffset ?? 0,
        ...values,
      };
    });
  const reset = {
    outlineWidth: undefined,
    outlineOffset: undefined,
    outlineColor: undefined,
    outlineStyle: undefined,
    outlineToken: undefined,
    outlineHidden: undefined,
  };
  const remove = () => patchNodes(selection, () => reset);
  return (
    <OptionalSection
      id="outline-section"
      title="Outline"
      present={width > 0}
      // Adding an outline starts at Wonder's default (1px #000000, offset 0) so the change is visible at
      // once; nothing from an earlier outline comes back.
      onAdd={() =>
        patchNodes(selection, () => ({
          ...reset,
          outlineWidth: 1,
          outlineOffset: 0,
          outlineColor: "#000000",
        }))
      }
      tools={
        <LineStyleMenu
          label="Outline settings"
          name="outlineStyle"
          value={n.outlineStyle || "solid"}
          onChange={(next) =>
            patch({
              outlineStyle: next === "solid" ? undefined : next,
              outlineWidth: Math.max(width, 1),
            })
          }
        />
      }
    >
      {/* Wonder A3: `≡ 1 | |↔| 0 | eye | −`, then the colour row; no captions, no style row (105px). */}
      <div className="flex items-center gap-2">
        <Field
          name="outlineWidth"
          label="Outline width"
          numeric
          value={fmt(width)}
          className="flex-1"
          prefix={<IconAffix icon={StrokeWeightIcon} />}
          onCommit={(raw) => {
            const value = readNumber(raw, 0, 1000);
            if (typeof value === "string") return value;
            patch({ outlineWidth: value });
          }}
        />
        <Field
          name="outlineOffset"
          label="Outline offset"
          numeric
          value={fmt(n.outlineOffset ?? 0)}
          className="flex-1"
          prefix={<IconAffix icon={OutlineOffsetIcon} />}
          onCommit={(raw) => {
            const value = readNumber(raw, -1000, 1000);
            if (typeof value === "string") return value;
            patch({ outlineOffset: value, outlineWidth: Math.max(width, 1) });
          }}
        />
        <IconButton
          icon={hidden ? ClosedEyeIcon : Eye}
          label={hidden ? "Show outline" : "Hide outline"}
          data-effect-tool="visibility"
          onClick={() =>
            patchNodes(selection, () => ({ outlineHidden: hidden ? undefined : true }))
          }
        />
        <IconButton
          icon={RemoveIcon}
          label="Remove outline"
          data-effect-tool="remove"
          onClick={remove}
        />
      </div>
      <EffectColorField
        row
        name="outlineColor"
        label="Outline colour"
        value={color}
        tokens={doc.tokens}
        token={n.outlineToken}
        onToken={(name) =>
          patch({
            outlineToken: name || undefined,
            outlineColor: doc.tokens?.[name] ?? color,
            outlineWidth: Math.max(width, 1),
          })
        }
        onCommit={(next) =>
          patch({ outlineColor: next, outlineToken: undefined, outlineWidth: Math.max(width, 1) })
        }
      />
    </OptionalSection>
  );
}

/**
 * Section header tools: one `+` that appends a list item (Wonder's Shadow / Filters / Mask headers).
 * Body spacing measured from design/wonder/properties-audit (A4–A6): `fields` (Filters) puts the first row 36
 * below the divider with 12 below the last; `rows` (Shadow, Mask, Selection colors) uses 40 / 16 and a 33 px
 * row pitch, so one row makes an 81 px section.
 */
export function ListSection({
  id,
  title,
  addLabel,
  onAdd,
  addMenu,
  variant = "fields",
  children,
}: {
  id: string;
  title: string;
  addLabel: string;
  onAdd?: () => void;
  addMenu?: ReactNode;
  variant?: "fields" | "rows";
  children?: ReactNode;
}) {
  return (
    <section id={id} className="border-b border-border">
      <div className="flex h-7.75 items-center justify-between gap-2 px-3">
        <h3 className="truncate text-xs text-foreground-3">{title}</h3>
        {addMenu ?? <AddButton label={addLabel} onClick={onAdd} />}
      </div>
      {children ? (
        <div
          className={cn(
            "flex flex-col px-3",
            variant === "rows" ? "gap-2.25 pt-2.25 pb-4" : "gap-2 pt-1.25 pb-3",
          )}
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function AddButton({ label, ref, ...props }: ComponentProps<"button"> & { label: string }) {
  const local = useRef<HTMLButtonElement | null>(null);
  useHookClass(local, "insp-add");
  return (
    <IconButton
      icon={PlusIcon}
      label={label}
      ref={(el) => {
        local.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      {...props}
    />
  );
}
