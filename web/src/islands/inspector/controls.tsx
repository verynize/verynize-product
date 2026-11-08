// Compact inspector controls measured from design/wonder 22/25/43: 24px fields, 6px radius, #2b2b2b fill,
// 12px Inter, 8px prefix inset, 31px section headers, 3 × 80px columns with 8px gaps.
import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ComponentType,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { ChevronDown } from "lucide-react";
import { PlusIcon, RemoveIcon } from "@/components/icons";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { parseColor, toHex } from "./color";

/**
 * Add a plain (non-Tailwind) hook class that tests and legacy selectors rely on (e.g. `.insp-display`).
 * Applied after every render because React rewrites `className` when it changes.
 */
export function useHookClass<T extends HTMLElement>(ref: RefObject<T | null>, name: string) {
  useLayoutEffect(() => {
    ref.current?.classList.add(name);
  });
}

/**
 * Any icon component: lucide glyphs or the shared set in @/components/icons. Sizes follow the role scale in
 * components/icons.tsx (size-3 chevrons, size-3.5 chips/menus/field prefixes, size-4 icon buttons); the 1px stroke
 * comes from globals.css, so never pass `strokeWidth`.
 */
export type IconType = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

/* ---------- Icon button (24px hit area, 16px icon: panel-header and section tools) ---------- */
export function IconButton({
  icon: Icon,
  label,
  className,
  iconClassName,
  active,
  ...props
}: ComponentProps<"button"> & {
  icon: IconType;
  label: string;
  iconClassName?: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-active={active || undefined}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-foreground-3 hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 data-active:bg-accent data-active:text-foreground",
        className,
      )}
      {...props}
    >
      <Icon className={cn("size-4", iconClassName)} aria-hidden />
    </button>
  );
}

/* ---------- Sections ---------- */
export function Section({
  title,
  tools,
  children,
  id,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  tools?: ReactNode;
  children?: ReactNode;
  id?: string;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section id={id} className={cn("border-b border-border", className)}>
      <div className="flex h-7.75 items-center justify-between gap-2 px-3">
        <h3 className="truncate text-xs text-foreground-3">{title}</h3>
        {tools ? <div className="flex items-center gap-2">{tools}</div> : null}
      </div>
      {children ? (
        <div className={cn("flex flex-col gap-2 px-3 pt-1.25 pb-2.75", bodyClassName)}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Wonder's optional sections (Border, Outline, Export, Layer…). `present` comes from the document (or, for
 * UI-only panels, from local state): without it the 31px header shows only `+` (`.insp-add`), which calls
 * `onAdd` — data sections write their default there so the canvas changes at once. With it the header shows
 * `tools` and, when `onRemove` is given, a header `−`; data sections put their eye / `−` on the item row.
 */
export function OptionalSection({
  title,
  id,
  present,
  onAdd,
  onRemove,
  tools,
  addWhenPresent,
  addLabel,
  addDisabled,
  bodyClassName,
  children,
}: {
  title: string;
  id: string;
  present: boolean;
  onAdd: () => void;
  onRemove?: () => void;
  tools?: ReactNode;
  /**
   * Keep the header `+` (still `.insp-add`, after `tools`) while the section has a value, as Wonder's Border
   * does to add another side; `onAdd` is called in both states. `addDisabled` greys it out (all sides exist).
   */
  addWhenPresent?: boolean;
  /** Label of the `+` while present (default "Add <title>"). */
  addLabel?: string;
  addDisabled?: boolean;
  /** Extra classes for the body (e.g. Export's 11px bottom padding). */
  bodyClassName?: string;
  children: ReactNode;
}) {
  const plus = useRef<HTMLButtonElement>(null);
  useHookClass(plus, "insp-add");
  const name = title.toLowerCase();
  const add = (
    <IconButton
      icon={PlusIcon}
      label={present && addLabel ? addLabel : "Add " + name}
      ref={plus}
      disabled={present && addDisabled}
      // Wonder's disabled `+` is a flat grey glyph, not a faded one.
      className="disabled:text-subtle-foreground disabled:opacity-100"
      onClick={onAdd}
    />
  );
  return (
    <section id={id} className="border-b border-border" data-present={present || undefined}>
      <div
        className="flex h-7.75 items-center justify-between gap-2 px-3"
        onClick={(event) => {
          if (!present && !(event.target as HTMLElement).closest("button")) onAdd();
        }}
      >
        <h3 className="truncate text-xs text-foreground-3">{title}</h3>
        {present ? (
          tools || onRemove || addWhenPresent ? (
            <div className="flex items-center gap-2">
              {tools}
              {onRemove ? (
                <IconButton
                  icon={RemoveIcon}
                  label={"Remove " + name}
                  data-section-remove
                  onClick={onRemove}
                />
              ) : null}
              {addWhenPresent ? add : null}
            </div>
          ) : null
        ) : (
          add
        )}
      </div>
      {/* The body stays mounted while absent (hidden), so ids such as #artwork-scale keep resolving. */}
      {/* Wonder's optional body: first row 36px below the section top (31px header + 5), 12px bottom padding. */}
      <div
        hidden={!present}
        className={cn(
          present ? "flex" : "hidden",
          "flex-col gap-2 px-3 pt-1.25 pb-3",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

export function Caption({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/* ---------- Field shell ---------- */
/**
 * The one field shell every inspector control shares (design/wonder 22/43, 2026-10-30/05–06): 24px tall, 6px radius,
 * #2b2b2b fill, 8px side insets. With a prefix the left inset is 6px and the prefix sits in a 14px slot, so values
 * start 25px in whether the prefix is a letter (X, W) or an icon. The value takes the free width (`min-w-0`); unit,
 * dropdown and variable slots never shrink, so a long number truncates instead of running under the unit.
 */
export const fieldShell =
  "group/field relative flex h-6 min-w-0 items-center gap-1.25 rounded-md bg-input px-2 text-xs text-foreground shadow-field focus-within:ring-1 focus-within:ring-ring";
const fieldBox = fieldShell;
/** Left inset used when the field starts with a prefix slot. */
// Properties audit B5: after a prefix the value starts 4px later, at x 36.5 like Wonder (was 38 with gap-1.25).
export const fieldPrefixInset = "gap-1 pl-1.5";

/** 14px field-prefix icon (opacity, radius, rotation, gap, padding…) in the 14px prefix slot. */
export function IconAffix({ icon: Icon }: { icon: IconType }) {
  return (
    <span className="flex w-3.5 shrink-0 select-none items-center justify-center text-muted-foreground">
      <Icon className="size-3.5" aria-hidden />
    </span>
  );
}

/** Letter prefix (X, Y, W, H, Z…) in the same 14px slot as IconAffix. */
export function Affix({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "flex w-3.5 shrink-0 select-none items-center justify-center text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

type FieldProps = {
  name?: string;
  label: string;
  value: string;
  onCommit: (value: string) => string | null | void;
  prefix?: ReactNode;
  suffix?: ReactNode;
  numeric?: boolean;
  step?: number;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
  /** Drag the prefix horizontally to scrub numeric values (committed once on release). */
  scrub?: boolean;
  /** id of a <datalist> with suggestions. */
  list?: string;
};

/** Commit on Enter/blur, Escape reverts, ArrowUp/Down ±step (Shift ×10). */
export function Field({
  name,
  label,
  value,
  onCommit,
  prefix,
  suffix,
  numeric,
  step = 1,
  placeholder,
  className,
  inputClassName,
  disabled,
  scrub = numeric,
  list,
}: FieldProps) {
  const [draft, setDraftState] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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
  const nudge = (direction: number, big: boolean) => {
    const base = Number(draftRef.current ?? value);
    if (!Number.isFinite(base)) return;
    const next = Math.round((base + direction * step * (big ? 10 : 1)) * 1000) / 1000;
    setDraft(null);
    onCommit(String(next));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
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
      nudge(event.key === "ArrowUp" ? 1 : -1, event.shiftKey);
    }
  };
  const onScrubStart = (event: PointerEvent<HTMLSpanElement>) => {
    if (!scrub || disabled || event.button !== 0) return;
    const start = Number(value);
    if (!Number.isFinite(start)) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const x0 = event.clientX;
    let moved = false;
    const move = (e: globalThis.PointerEvent) => {
      const dx = e.clientX - x0;
      if (Math.abs(dx) < 2 && !moved) return;
      moved = true;
      const next =
        Math.round((start + Math.round(dx / 2) * step * (e.shiftKey ? 10 : 1)) * 1000) / 1000;
      setDraft(String(next));
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      if (moved) commit();
      else inputRef.current?.focus();
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };
  return (
    <div data-field-shell className={cn(fieldBox, prefix && fieldPrefixInset, className)}>
      {prefix ? (
        <span
          className={cn("flex shrink-0 items-center", scrub && !disabled && "cursor-ew-resize")}
          onPointerDown={onScrubStart}
        >
          {prefix}
        </span>
      ) : null}
      <input
        ref={inputRef}
        name={name}
        list={list}
        aria-label={label}
        title={label}
        value={draft ?? value}
        placeholder={placeholder}
        disabled={disabled}
        inputMode={numeric ? "decimal" : undefined}
        autoComplete="off"
        spellCheck={false}
        className={cn(
          "h-full w-full min-w-0 flex-1 truncate bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground disabled:text-muted-foreground",
          numeric && "tabular-nums",
          // Wonder (A9 multi-select): "Mixed" reads as a value (#E8E8E8), not as a muted placeholder.
          placeholder === "Mixed" && "placeholder:text-foreground",
          inputClassName,
        )}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {suffix ? (
        <span
          data-field-suffix
          className="relative flex shrink-0 select-none items-center gap-1 text-muted-foreground"
        >
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

/* ---------- Native select (tests use Playwright selectOption on these) ---------- */
export function NativeSelect({
  name,
  label,
  value,
  options,
  onChange,
  prefix,
  className,
  selectClassName,
  bare,
  id,
  disabled,
}: {
  name?: string;
  id?: string;
  disabled?: boolean;
  label: string;
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
  onChange: (value: string) => void;
  prefix?: ReactNode;
  className?: string;
  selectClassName?: string;
  /** Render without the field background (e.g. the px/Hug/Fill unit inside the W/H fields). */
  bare?: boolean;
}) {
  return (
    <div
      className={cn(
        bare
          ? "relative flex h-6 shrink-0 items-center"
          : // Disabled field (properties-audit B4/C1): #242424 fill, #828282 value, dim caret.
            cn(fieldBox, "pr-0", disabled && "bg-field-disabled", prefix && fieldPrefixInset),
        className,
      )}
    >
      {prefix}
      <select
        id={id}
        name={name}
        aria-label={label}
        title={label}
        value={value}
        disabled={disabled}
        className={cn(
          "h-full min-w-0 cursor-default appearance-none truncate bg-transparent text-xs text-foreground outline-none disabled:text-field-disabled-foreground",
          // A bare select (unit / sizing mode inside a field) is as wide as its current label.
          bare ? "field-sizing-content pr-4 text-muted-foreground" : "w-full pr-6",
          selectClassName,
        )}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((o) => (
          <option
            key={o.value}
            value={o.value}
            disabled={o.disabled}
            className="bg-popover text-foreground"
          >
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className={cn(
          "pointer-events-none absolute size-3 text-muted-foreground",
          !bare && disabled && "text-disabled-glyph",
          bare ? "right-0" : "right-2.5",
        )}
      />
    </div>
  );
}

/* ---------- Segmented control (Radix ToggleGroup) ---------- */
export function Segmented({
  value,
  onChange,
  items,
  label,
  className,
  itemClassName,
  dataKey,
  hook,
  deselectable,
}: {
  value: string;
  onChange: (value: string) => void;
  items: { value: string; label: string; icon: IconType }[];
  label: string;
  className?: string;
  itemClassName?: string;
  /** Adds `data-<dataKey>=<value>` to each item (e.g. `data-layout`). */
  dataKey?: string;
  /** Plain hook class for selectors (e.g. `insp-display`). */
  hook?: string;
  /** Pressing the active item clears the value (`onChange("")`), e.g. the flex distribution row. */
  deselectable?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  useHookClass(root, hook ?? "insp-segmented");
  return (
    <ToggleGroupPrimitive.Root
      ref={root}
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(next) => (next || deselectable) && onChange(next)}
      className={cn("flex h-6 w-full items-stretch rounded-md bg-muted", className)}
    >
      {items.map(({ value: v, label: l, icon: Icon }) => (
        <ToggleGroupPrimitive.Item
          key={v}
          value={v}
          aria-label={l}
          title={l}
          {...(dataKey ? { [`data-${dataKey}`]: v } : {})}
          className={cn(
            // Wonder's active segment: #363636 with a faint 1px edge and a soft drop (22, 2026-10-30/05).
            "flex min-w-0 flex-1 items-center justify-center rounded-md text-subtle-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring data-[state=on]:bg-accent data-[state=on]:text-foreground",
            itemClassName,
          )}
        >
          <Icon className="size-4" aria-hidden />
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}

/* ---------- Colour swatch (dynamic colour set through the DOM, no inline style props) ---------- */
const SWATCH_CHECKER =
  "repeating-conic-gradient(var(--accent) 0% 25%, var(--muted) 0% 50%) 50% / 8px 8px";
/** A translucent colour shows Wonder's split swatch: opaque on the left, the colour over a checker on the right. */
function swatchBackground(color: string) {
  const c = color ? parseColor(color) : null;
  if (!c || c.a >= 1) return color || "transparent";
  const opaque = toHex({ ...c, a: 1 });
  return `linear-gradient(to right, ${opaque} 50%, ${toHex(c)} 50%), ${SWATCH_CHECKER}`;
}

/** `checker`: a fully transparent paint (the hidden page background), drawn as the checker alone. */
export function Swatch({
  color,
  className,
  checker,
}: {
  color: string;
  className?: string;
  checker?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (ref.current)
      ref.current.style.background = checker ? SWATCH_CHECKER : swatchBackground(color);
  }, [color, checker]);
  return (
    <span
      ref={ref}
      aria-hidden
      className={cn("block size-4 shrink-0 rounded-sm ring-1 ring-card", className)}
    />
  );
}
