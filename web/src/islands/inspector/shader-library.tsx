// Shader fill library (behaviour modelled on design/wonder/2026-10-30/30–31): a searchable preset picker,
// the four colours of a parametric preset (each bindable to a Colors variable) and a "Shader settings" popover
// with six sliders. The catalog, defaults and rendering live in web/shaders.js (window.BetterShaders).
// Shader layers use it in their "Shader Fill"; any other layer gets the same controls in Shader mode (Wonder H6,
// `shaderFill`): a preset dropdown with a settings button beside it, then the preset's colours.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { SlidersIcon } from "@/components/icons";
import type { DesignDocument } from "@/lib/bridge";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Caption, IconButton } from "./controls";
import { EffectColorField } from "./effects";
import { patchNodes, type Node } from "./model";

export type ShaderRole = "center" | "edge" | "ripple" | "background";
export type ShaderParamKey = "aspect" | "size" | "density" | "distortion" | "grain";
export type ShaderPreset = {
  id: string;
  name: string;
  family: string;
  kind: "legacy" | "param";
  defaults: {
    colors?: Record<ShaderRole, string>;
    speed: number;
  } & Partial<Record<ShaderParamKey, number>>;
};
type ShaderColors = Partial<Record<ShaderRole, { color: string; token?: string }>>;
type ShaderNode = Node & {
  shaderColors?: ShaderColors;
  shaderParams?: Partial<Record<ShaderParamKey, number>>;
};
type Resolved = {
  kind: "param" | "legacy";
  colors: Record<ShaderRole, string>;
  speed: number;
} & Record<ShaderParamKey, number>;
type Library = {
  PRESETS: ShaderPreset[];
  presetOf(id: string): ShaderPreset;
  resolve(node: unknown, tokens: Record<string, string> | undefined): Resolved;
};

const library = () => (window as unknown as { BetterShaders?: Library }).BetterShaders;
export const shaderPresets = (): ShaderPreset[] => library()?.PRESETS ?? [];
export const shaderPresetName = (id: string | undefined) =>
  shaderPresets().find((p) => p.id === id)?.name ?? "Aurora";
export const isParam = (id: string | undefined) =>
  shaderPresets().find((p) => p.id === id)?.kind === "param";

const COLOR_ROWS: [ShaderRole, string][] = [
  ["center", "Gradient Center"],
  ["edge", "Gradient Edge"],
  ["ripple", "Ripple Color"],
  ["background", "Background"],
];
const SLIDERS: { key: ShaderParamKey | "speed"; label: string; max: number; step: number }[] = [
  { key: "aspect", label: "Gradient Aspect", max: 100, step: 1 },
  { key: "size", label: "Gradient Size", max: 100, step: 1 },
  { key: "density", label: "Ripple Density", max: 100, step: 1 },
  { key: "speed", label: "Animation Speed", max: 5, step: 0.1 },
  { key: "distortion", label: "Distortion Amount", max: 100, step: 1 },
  { key: "grain", label: "Grain Strength", max: 100, step: 1 },
];

/**
 * Choosing a preset loads its defaults: stored colours/sliders are cleared, parametric presets set their speed.
 * A layer in Shader mode keeps its type (only its fill changes); any other layer becomes a shader layer.
 */
export function applyShaderPreset(selection: string[], preset: ShaderPreset) {
  patchNodes(selection, (n) => ({
    ...(n.shaderFill && n.type !== "shader" ? {} : { type: "shader" }),
    shaderPreset: preset.id,
    shaderColors: undefined,
    shaderParams: undefined,
    ...(preset.kind === "param" ? { shaderSpeed: preset.defaults.speed } : {}),
  }));
}

/* ---------- Preset picker ("Choose shader") ---------- */
function PresetPreview({ preset, fallback }: { preset: ShaderPreset; fallback: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const c = preset.defaults.colors;
    ref.current.style.background = c
      ? `radial-gradient(circle at 50% 55%, ${c.ripple} 0 4%, ${c.center} 18%, ${c.edge} 62%, ${c.background})`
      : `linear-gradient(135deg, ${fallback}, ${fallback}55)`;
  }, [preset, fallback]);
  return <span ref={ref} aria-hidden className="block h-16 w-full shrink-0 rounded-md" />;
}

export function ShaderPicker({
  node,
  selection,
  open,
  onOpenChange,
  children,
}: {
  node: Node;
  selection: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  // Closing clears the search (adjusted during render, not in an effect).
  if (!open && query) setQuery("");
  const presets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return shaderPresets().filter(
      (p) => !q || p.name.toLowerCase().includes(q) || p.family.toLowerCase().includes(q),
    );
  }, [query]);
  return (
    <Popover open={open} onOpenChange={onOpenChange} modal={false}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        id="shader-gallery"
        side="left"
        align="start"
        sideOffset={16}
        collisionPadding={8}
        className="w-80"
        onOpenAutoFocus={(event) => {
          // Focus the search field, as Wonder's picker does (30-shader-library).
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)
            ?.querySelector<HTMLInputElement>("input[name=shaderSearch]")
            ?.focus();
        }}
      >
        <div className="flex max-h-120 flex-col gap-2">
          <div className="flex h-7 items-center justify-between">
            <strong className="text-xs font-normal text-foreground">Choose shader</strong>
            <IconButton icon={X} label="Close shader library" onClick={() => onOpenChange(false)} />
          </div>
          <label className="flex h-7 items-center gap-2 rounded-md bg-input px-2 text-xs shadow-field focus-within:ring-1 focus-within:ring-ring">
            <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <input
              name="shaderSearch"
              aria-label="Search shaders"
              placeholder="Search shaders…"
              autoComplete="off"
              spellCheck={false}
              value={query}
              className="h-full min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div
            role="listbox"
            aria-label="Shader presets"
            className="grid min-h-0 auto-rows-max grid-cols-3 gap-2 overflow-y-auto"
          >
            {presets.map((preset) => {
              const selected = preset.id === node.shaderPreset;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-shader-option={preset.id}
                  className="relative flex min-w-0 flex-col gap-1 rounded-md p-1 text-left text-xs text-foreground-2 hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring aria-selected:ring-1 aria-selected:ring-primary"
                  onClick={() => {
                    applyShaderPreset(selection, preset);
                    onOpenChange(false);
                  }}
                >
                  <PresetPreview preset={preset} fallback={node.color || "#a58bdd"} />
                  <span className="truncate">{preset.name}</span>
                  {selected ? (
                    <Check
                      className="absolute top-2 right-2 size-3.5 rounded-full bg-primary text-primary-foreground"
                      aria-hidden
                    />
                  ) : null}
                </button>
              );
            })}
            {!presets.length ? (
              <p className="col-span-3 px-1 py-3 text-xs text-muted-foreground">
                No shaders match “{query.trim()}”
              </p>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ---------- Shader settings sliders ---------- */
function ParamSlider({
  name,
  label,
  value,
  max,
  step,
  onCommit,
}: {
  name: string;
  label: string;
  value: number;
  max: number;
  step: number;
  onCommit: (value: number) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const commit = useRef(onCommit);
  useLayoutEffect(() => {
    commit.current = onCommit;
  });
  // Commit on the native `change` event (pointer release / key press) so a drag is one undo step.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const done = () => {
      setDraft(null);
      const next = Number(el.value);
      if (Number.isFinite(next)) commit.current(next);
    };
    el.addEventListener("change", done);
    return () => el.removeEventListener("change", done);
  }, []);
  return (
    <Caption label={label}>
      <input
        ref={ref}
        type="range"
        name={name}
        aria-label={label}
        min={0}
        max={max}
        step={step}
        value={draft ?? value}
        className="h-1.5 w-full cursor-pointer appearance-auto rounded-full bg-muted accent-primary"
        onChange={(event) => setDraft(Number(event.target.value))}
      />
    </Caption>
  );
}

function ShaderOptions({
  selection,
  values,
  compact,
}: {
  selection: string[];
  values: Resolved;
  /** Shader mode: an icon button beside the preset dropdown (Wonder H6) instead of the labelled button. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverAnchor asChild>
        {compact ? (
          <IconButton
            icon={SlidersIcon}
            label="Shader settings"
            id="shader-options-open"
            aria-expanded={open}
            active={open}
            onClick={() => setOpen(!open)}
          />
        ) : (
          <button
            type="button"
            id="shader-options-open"
            aria-expanded={open}
            className="flex h-6 items-center justify-center gap-1.5 rounded-md bg-input text-xs text-foreground shadow-field hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => setOpen(!open)}
          >
            <SlidersHorizontal className="size-3.5 text-muted-foreground" aria-hidden />
            Shader settings
          </button>
        )}
      </PopoverAnchor>
      <PopoverContent
        id="shader-options"
        side="left"
        align="start"
        sideOffset={16}
        collisionPadding={8}
        className="w-72"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if ((event.target as HTMLElement | null)?.closest?.("#shader-options-open"))
            event.preventDefault();
        }}
      >
        <div className="flex flex-col gap-2">
          <div className="flex h-7 items-center justify-between">
            <strong className="text-xs font-normal text-foreground">Shader settings</strong>
            <IconButton icon={X} label="Close shader settings" onClick={() => setOpen(false)} />
          </div>
          {SLIDERS.map(({ key, label, max, step }) => (
            <ParamSlider
              key={key}
              name={"shader-" + key}
              label={label}
              value={key === "speed" ? values.speed : values[key]}
              max={max}
              step={step}
              onCommit={(value) =>
                patchNodes(selection, (n) =>
                  key === "speed"
                    ? { shaderSpeed: Math.min(5, Math.max(0, value)) }
                    : {
                        shaderParams: {
                          ...(n as ShaderNode).shaderParams,
                          [key]: Math.min(100, Math.max(0, Math.round(value))),
                        },
                      },
                )
              }
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ---------- Colours of a parametric preset ---------- */
type ShaderProps = { doc: DesignDocument; node: Node; selection: string[] };

function ShaderColorRows({ doc, node, selection, values }: ShaderProps & { values: Resolved }) {
  const stored = (node as ShaderNode).shaderColors ?? {};
  const write = (role: ShaderRole, holder: { color: string; token?: string }) =>
    patchNodes(selection, (n) => ({
      shaderColors: { ...(n as ShaderNode).shaderColors, [role]: holder },
    }));
  return COLOR_ROWS.map(([role, label]) => (
    <Caption key={role} label={label}>
      <div className="flex items-center gap-2" data-shader-color-row={role}>
        <EffectColorField
          name={"shader-" + role}
          label={label}
          value={stored[role]?.color ?? values.colors[role]}
          tokens={doc.tokens}
          token={stored[role]?.token}
          onToken={(name) =>
            write(
              role,
              name
                ? { color: doc.tokens?.[name] ?? values.colors[role], token: name }
                : { color: values.colors[role] },
            )
          }
          onCommit={(color) => write(role, { color })}
        />
      </div>
    </Caption>
  ));
}

export function ShaderParameters({ doc, node, selection }: ShaderProps) {
  const lib = library();
  if (!lib || node.type !== "shader" || !isParam(node.shaderPreset)) return null;
  const values = lib.resolve(node, doc.tokens);
  return (
    <div id="shader-parameters" className={cn("flex flex-col gap-2")}>
      <ShaderColorRows doc={doc} node={node} selection={selection} values={values} />
      <ShaderOptions selection={selection} values={values} />
    </div>
  );
}

/* ---------- Shader mode (Wonder H6) ---------- */
/** The first parametric preset: what Shader mode starts with on a layer that never chose a preset. */
export const defaultFillPreset = () => shaderPresets().find((p) => p.kind === "param");

/**
 * Shader mode body (wonder/H6-open-confirmed): a preset dropdown (x 12–232) with the settings button at x 256,
 * then the preset's colour rows, which replace the paint rows. Classic presets take the fill colour, so their
 * paint stack stays below (FillSection).
 */
export function ShaderFill({ doc, node, selection }: ShaderProps) {
  const [picker, setPicker] = useState(false);
  const lib = library();
  if (!lib || node.type === "shader" || !node.shaderFill) return null;
  const values = lib.resolve(node, doc.tokens);
  return (
    <div id="shader-fill" className="flex flex-col gap-2" data-shader-fill={node.shaderPreset}>
      <div className="flex items-center gap-3">
        <ShaderPicker node={node} selection={selection} open={picker} onOpenChange={setPicker}>
          <button
            type="button"
            id="shader-fill-preset"
            aria-label="Shader preset"
            aria-haspopup="listbox"
            aria-expanded={picker}
            className="flex h-6 min-w-0 flex-1 items-center justify-between gap-2 rounded-md bg-input px-2 text-xs text-foreground shadow-field hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => setPicker(!picker)}
          >
            <span className="truncate">{shaderPresetName(node.shaderPreset)}</span>
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </ShaderPicker>
        <ShaderOptions selection={selection} values={values} compact />
      </div>
      {values.kind === "param" ? (
        <ShaderColorRows doc={doc} node={node} selection={selection} values={values} />
      ) : null}
    </div>
  );
}
