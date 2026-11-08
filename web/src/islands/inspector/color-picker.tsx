// Colour picker popover (design/wonder 23): saturation/value plane, hue and alpha sliders, HEX/RGB/HSL/OKLCH
// format switch, eyedropper, copy, channel fields, value field (`#color-value`) and alpha percentage.
// "Variables" lists colour variables when the caller can bind one. Dynamic colours are written through refs
// (no inline style props, see controls.tsx Swatch).
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Check, Copy, Folder, Pipette, Unlink, X } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Field, IconButton, NativeSelect, Swatch, useHookClass } from "./controls";
import {
  FORMATS,
  channels,
  cssColor,
  formatColor,
  hasAlpha,
  hsvaToRgba,
  parseColor,
  rgbaToHsva,
  toHex,
  withChannel,
  type ColorFormat,
  type Hsva,
} from "./color";
import { groupByFolder, leafOf } from "./vars";

// Remember the last chosen format across pickers (Wonder keeps it per session).
let lastFormat: ColorFormat = "hex";
const CHECKER = "repeating-conic-gradient(var(--accent) 0% 25%, var(--muted) 0% 50%) 50% / 8px 8px";

/**
 * Dynamic style through a ref. Applied after every render, not only when the style changes: an element that mounts
 * later (the plane after switching from Variables to Custom on a bound paint) must still get its background.
 */
function useStyle(ref: React.RefObject<HTMLElement | null>, style: Partial<CSSStyleDeclaration>) {
  useLayoutEffect(() => {
    if (ref.current) Object.assign(ref.current.style, style);
  });
}

/** Drag helper: calls `move` with the pointer position normalised to the element (0–1). */
function useDrag(onMove: (x: number, y: number) => void, onEnd: () => void) {
  return (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const el = event.currentTarget;
    el.setPointerCapture(event.pointerId);
    el.focus();
    const at = (e: PointerEvent | ReactPointerEvent) => {
      const r = el.getBoundingClientRect();
      onMove(
        Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
        Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
      );
    };
    at(event);
    const move = (e: PointerEvent) => at(e);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      onEnd();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
}

function Slider({
  label,
  value,
  max,
  track,
  onDrag,
  onEnd,
  onStep,
}: {
  label: string;
  value: number;
  max: number;
  track: string;
  onDrag: (fraction: number) => void;
  onEnd: () => void;
  onStep: (delta: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  useStyle(trackRef, { background: track });
  useStyle(thumbRef, { left: `calc(${(value / max) * 100}% - 5px)` });
  const start = useDrag((x) => onDrag(x), onEnd);
  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      className="relative mx-1.25 h-6 touch-none rounded-md shadow-field outline-none focus-visible:ring-1 focus-visible:ring-ring"
      onPointerDown={start}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 10 : 1;
        if (event.key === "ArrowRight" || event.key === "ArrowUp") onStep(step);
        else if (event.key === "ArrowLeft" || event.key === "ArrowDown") onStep(-step);
        else return;
        event.preventDefault();
      }}
    >
      <span
        ref={thumbRef}
        aria-hidden
        className="pointer-events-none absolute inset-y-0 w-2.5 rounded-full border-2 border-foreground shadow-menu"
      />
    </div>
  );
}

export type ColorPickerProps = {
  value: string;
  /** Live value while dragging (not committed). */
  onPreview?: (color: string) => void;
  /** Committed value (one undo step). */
  onCommit: (color: string) => void;
  /** Colour variables to offer under "Variables" (name → colour) and the bound one. */
  tokens?: Record<string, string>;
  token?: string;
  onToken?: (name: string) => void;
  onClose: () => void;
  /** Heading of the picker (default "Color"). */
  title?: string;
  /** Extra controls under the heading (the gradient editor puts its stops here). */
  header?: ReactNode;
  /** Paint type switch, on the left of the Custom / Variables row (Wonder: one row, type icons then tabs). */
  typeSwitch?: ReactNode;
  /** Extra buttons in the title row, before the close button (paint reorder). */
  headTools?: ReactNode;
  /**
   * For a bound value: Custom-tab edits change the variable itself (Wonder B3: translucency lives in the variable),
   * so the picker says so and offers an explicit detach instead of silently unbinding.
   */
  onDetach?: () => void;
};

export function ColorPicker({
  value,
  onPreview,
  onCommit,
  tokens,
  token,
  onToken,
  onClose,
  title = "Color",
  header,
  typeSwitch,
  headTools,
  onDetach,
}: ColorPickerProps) {
  const parsed = parseColor(value) ?? { r: 165, g: 139, b: 221, a: 1 };
  const [hsva, setHsva] = useState<Hsva>(() => rgbaToHsva(parsed));
  const [format, setFormat] = useState<ColorFormat>(lastFormat);
  const [tab, setTab] = useState<"custom" | "variables">(token ? "variables" : "custom");
  const live = useRef(hsva);
  const emitted = useRef(toHex(parsed));
  // External changes (undo, another editor) re-seed the picker, keeping the hue for greys.
  useEffect(() => {
    const next = parseColor(value);
    if (!next || toHex(next) === emitted.current) return;
    emitted.current = toHex(next);
    const h = rgbaToHsva(next);
    const seeded = h.s === 0 || h.v === 0 ? { ...h, h: live.current.h } : h;
    live.current = seeded;
    setHsva(seeded);
  }, [value]);

  const rgba = hsvaToRgba(hsva);
  const update = (next: Hsva, commit: boolean) => {
    live.current = next;
    setHsva(next);
    const out = toHex(hsvaToRgba(next));
    emitted.current = out;
    if (commit) onCommit(out);
    else onPreview?.(out);
  };
  const commitLive = () => {
    const out = toHex(hsvaToRgba(live.current));
    emitted.current = out;
    onCommit(out);
  };
  const setFromColor = (text: string) => {
    const c = parseColor(text);
    if (!c) return "Enter a colour (hex, rgb(), hsl() or oklch())";
    const h = rgbaToHsva(!hasAlpha(text) ? { ...c, a: hsva.a } : c);
    update(h.s === 0 || h.v === 0 ? { ...h, h: hsva.h } : h, true);
    return null;
  };

  const plane = useRef<HTMLDivElement>(null);
  const planeThumb = useRef<HTMLSpanElement>(null);
  useStyle(plane, {
    background: `linear-gradient(to top, black, transparent), linear-gradient(to right, white, hsl(${hsva.h} 100% 50%))`,
  });
  useStyle(planeThumb, {
    left: `calc(${hsva.s * 100}% - 6px)`,
    top: `calc(${(1 - hsva.v) * 100}% - 6px)`,
    background: toHex({ ...rgba, a: 1 }),
  });
  const dragPlane = useDrag(
    (x, y) => update({ ...live.current, s: x, v: 1 - y }, false),
    commitLive,
  );

  const head = useRef<HTMLDivElement>(null);
  useHookClass(head, "dialog-head");
  const tokenEntries = Object.entries(tokens ?? {});
  const copy = async () => {
    const text = cssColor(rgba, format);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const input = document.createElement("textarea");
      input.value = text;
      document.body.append(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
  };
  const EyeDropperCtor = (
    window as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }
  ).EyeDropper;

  return (
    <div className="flex flex-col gap-2">
      <div className="-mt-1 flex h-7 items-center gap-1">
        <strong className="min-w-0 flex-1 truncate text-xs font-normal text-foreground">
          {title}
        </strong>
        {headTools}
        {/* `.dialog-head button` is the close button (tests and legacy callers). */}
        <div ref={head} className="flex items-center">
          <IconButton icon={X} label="Close colour picker" onClick={onClose} />
        </div>
      </div>
      {header}
      {typeSwitch || onToken ? (
        // Wonder A2: without paint-type icons (strokes, shadows) the tabs sit on the left, right under the title.
        <div
          className={cn(
            "flex h-6 items-center gap-2",
            typeSwitch ? "justify-between" : "justify-start",
          )}
        >
          {typeSwitch ?? null}
          {onToken ? <SourceTabs tab={tab} onTab={setTab} /> : null}
        </div>
      ) : null}
      {token && onDetach && tab === "custom" ? (
        <div
          data-bound-edit={token}
          className="-mb-1 flex h-6 items-center gap-2 text-2xs text-muted-foreground"
        >
          <span className="min-w-0 flex-1 truncate">Editing variable {token}</span>
          <button
            type="button"
            aria-label="Detach variable"
            className="flex h-5 items-center gap-1 rounded-sm px-1 text-foreground-3 hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
            onClick={onDetach}
          >
            <Unlink className="size-3.5" aria-hidden />
            Detach
          </button>
        </div>
      ) : null}
      {tab === "variables" && onToken ? (
        <div
          role="listbox"
          aria-label="Colour variables"
          className="flex max-h-72 min-h-40 flex-col overflow-y-auto"
        >
          {groupByFolder(tokenEntries).map(({ folder, items }) => (
            <div
              key={folder || "/"}
              role="group"
              aria-label={folder || "Colors"}
              data-variable-folder={folder}
              className="flex flex-col"
            >
              {folder ? (
                <div className="flex h-7 items-center gap-1 px-2 text-xs text-muted-foreground">
                  <Folder className="size-3.5" aria-hidden />
                  <span className="min-w-0 truncate">{folder}</span>
                </div>
              ) : null}
              {items.map(([name, color]) => (
                <button
                  key={name}
                  type="button"
                  role="option"
                  aria-selected={token === name}
                  aria-label={name}
                  data-variable={name}
                  className={cn(
                    "flex h-7 items-center gap-2 rounded-md px-2 text-left text-xs text-foreground-2 hover:bg-accent",
                    folder && "pl-6",
                  )}
                  onClick={() => onToken(name)}
                >
                  <Swatch color={color} className="size-3.5" />
                  <span className="min-w-0 flex-1 truncate">{folder ? leafOf(name) : name}</span>
                  <span className="text-muted-foreground uppercase">{color}</span>
                  {token === name ? <Check className="size-3.5" aria-hidden /> : null}
                </button>
              ))}
            </div>
          ))}
          {!tokenEntries.length ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              No colour variables yet. Create one with + in Variables.
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <div
            ref={plane}
            id="color-field"
            role="slider"
            tabIndex={0}
            aria-label="Saturation and brightness"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(hsva.s * 100)}
            aria-valuetext={`Saturation ${Math.round(hsva.s * 100)}%, brightness ${Math.round(hsva.v * 100)}%`}
            className="relative h-60 touch-none rounded-md outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onPointerDown={dragPlane}
            onKeyDown={(event) => {
              const d = (event.shiftKey ? 10 : 1) / 100;
              const moves: Record<string, [number, number]> = {
                ArrowLeft: [-d, 0],
                ArrowRight: [d, 0],
                ArrowUp: [0, d],
                ArrowDown: [0, -d],
              };
              const m = moves[event.key];
              if (!m) return;
              event.preventDefault();
              update(
                {
                  ...hsva,
                  s: Math.min(1, Math.max(0, hsva.s + m[0])),
                  v: Math.min(1, Math.max(0, hsva.v + m[1])),
                },
                true,
              );
            }}
          >
            <span
              ref={planeThumb}
              aria-hidden
              className="pointer-events-none absolute size-3 rounded-full ring-2 ring-primary-foreground shadow-menu"
            />
          </div>
          <Slider
            label="Hue"
            value={hsva.h}
            max={360}
            track="linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
            onDrag={(x) => update({ ...live.current, h: x * 360 }, false)}
            onEnd={commitLive}
            onStep={(delta) =>
              update({ ...hsva, h: Math.min(360, Math.max(0, hsva.h + delta)) }, true)
            }
          />
          <Slider
            label="Opacity"
            value={hsva.a * 100}
            max={100}
            track={`linear-gradient(to right, transparent, ${toHex({ ...rgba, a: 1 })}), ${CHECKER}`}
            onDrag={(x) => update({ ...live.current, a: Math.round(x * 100) / 100 }, false)}
            onEnd={commitLive}
            onStep={(delta) =>
              update(
                { ...hsva, a: Math.min(1, Math.max(0, Math.round(hsva.a * 100 + delta) / 100)) },
                true,
              )
            }
          />
          <div className="flex items-center gap-2">
            <NativeSelect
              label="Colour format"
              className="flex-1"
              value={format}
              options={FORMATS}
              onChange={(v) => {
                lastFormat = v as ColorFormat;
                setFormat(v as ColorFormat);
              }}
            />
            {EyeDropperCtor ? (
              <IconButton
                icon={Pipette}
                label="Pick colour from screen"
                className="bg-input shadow-field"
                iconClassName="size-3.5"
                onClick={async () => {
                  try {
                    const result = await new EyeDropperCtor().open();
                    setFromColor(result.sRGBHex);
                  } catch {
                    /* cancelled */
                  }
                }}
              />
            ) : null}
            <IconButton
              icon={Copy}
              label="Copy colour"
              className="bg-input shadow-field"
              iconClassName="size-3.5"
              onClick={copy}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {channels(rgba, format).map((ch, i) => (
              <Field
                key={format + i}
                label={ch.label}
                numeric
                step={ch.step}
                value={String(ch.value)}
                inputClassName={cn("text-right", format === "hex" && "text-muted-foreground")}
                onCommit={(text) => {
                  const n = Number(text);
                  if (!Number.isFinite(n)) return "Enter a number";
                  const next = rgbaToHsva(withChannel(rgba, format, i, n));
                  update(next.s === 0 || next.v === 0 ? { ...next, h: hsva.h } : next, true);
                }}
              />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <ColorValueField
              value={formatColor(rgba, format)}
              format={format}
              onCommit={setFromColor}
            />
            <Field
              label="Opacity percent"
              numeric
              value={String(Math.round(hsva.a * 100))}
              prefix={<span className="w-3 text-muted-foreground">A</span>}
              suffix="%"
              inputClassName="text-right"
              onCommit={(text) => {
                const n = Number(text);
                if (!Number.isFinite(n)) return "Enter a number";
                update({ ...hsva, a: Math.min(100, Math.max(0, n)) / 100 }, true);
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function SourceTabs({
  tab,
  onTab,
}: {
  tab: "custom" | "variables";
  onTab: (tab: "custom" | "variables") => void;
}) {
  return (
    <div role="tablist" aria-label="Colour source" className="flex h-6 rounded-md bg-muted">
      {(["custom", "variables"] as const).map((t) => (
        <button
          key={t}
          type="button"
          role="tab"
          aria-selected={tab === t}
          className="rounded-md px-2 text-xs text-muted-foreground hover:text-foreground aria-selected:bg-accent aria-selected:text-foreground"
          onClick={() => onTab(t)}
        >
          {t === "custom" ? "Custom" : "Variables"}
        </button>
      ))}
    </div>
  );
}

/** The value field (`#color-value`): accepts any CSS colour; commits on Enter/blur/Tab. */
function ColorValueField({
  value,
  format,
  onCommit,
}: {
  value: string;
  format: ColorFormat;
  onCommit: (text: string) => string | null;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="col-span-2 flex h-6 min-w-0 items-center rounded-md bg-input px-2 shadow-field focus-within:ring-1 focus-within:ring-ring">
      <input
        id="color-value"
        aria-label={format === "hex" ? "Hex colour" : "Colour value"}
        autoComplete="off"
        spellCheck={false}
        value={draft ?? value}
        className={cn(
          "h-full w-full min-w-0 bg-transparent text-xs text-foreground outline-none",
          format === "hex" && "uppercase",
        )}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== null && draft !== value) onCommit(draft);
          setDraft(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(null);
          }
        }}
      />
    </div>
  );
}

/** Popover host: anchors the picker to `children` (the swatch row) and opens it to the left of the panel. */
export function ColorPopover({
  open,
  onOpenChange,
  children,
  ...picker
}: Omit<ColorPickerProps, "onClose"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange} modal={false}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        id="color-dialog"
        side="left"
        align="start"
        sideOffset={16}
        collisionPadding={8}
        className="w-72"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          // Keep the picker open while the user edits the anchoring row.
          if ((event.target as HTMLElement | null)?.closest?.("[data-color-anchor]"))
            event.preventDefault();
        }}
      >
        <ColorPicker {...picker} onClose={() => onOpenChange(false)} />
      </PopoverContent>
    </Popover>
  );
}
