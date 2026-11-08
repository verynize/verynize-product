// Export section (design/wonder/2026-10-30 21, 22, 41; properties-audit A7): a full-width file name, then size
// preset and format in two columns, then the Export button, as in Wonder. The file suffix follows the size
// ("@2x"); a custom suffix and the Selection / Page scope live in the "Export options" popover, whose trigger
// sits inside the name field and shows on hover (or while an option differs from its default).
// SVG is offered only when every exported layer is an SVG image; Code exports Tailwind JSX or HTML + CSS.
// Size and format are Wonder's styled menus (properties-audit G2): ✓ on the current item, separators between the
// size groups, 152px wide with 24px rows.
import { Fragment, useState } from "react";
import { Check, ChevronDown, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import type { DesignDocument } from "@/lib/bridge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Caption, Field, NativeSelect, OptionalSection, fieldShell } from "./controls";
import {
  CODE_FLAVORS,
  EXPORT_SCALES,
  UNSCALED,
  defaultSuffix,
  exportArtwork,
  exportFormats,
  exportedNodes,
  isSvgNode,
  type CodeFlavor,
  type ExportFormat,
} from "./export";
import type { Node } from "./model";

type Option = { value: string; label: string };

/** Scale presets in Wonder's three menu groups: ×-scales, target heights (720p…), then 512w / 512h. */
const scaleGroups = (options: Option[]) => {
  const kind = (o: Option) => (o.value.endsWith("p") ? 1 : /[wh]$/.test(o.value) ? 2 : 0);
  return [0, 1, 2].map((k) => options.filter((o) => kind(o) === k)).filter((g) => g.length);
};

/**
 * Field-styled menu like the constraints menu: a Radix trigger with a ✓ list, plus a transparent native select on
 * top (same id, no pointer or keyboard focus) so scripts and tests can still `selectOption("#artwork-scale")`.
 */
function MenuSelect({
  id,
  label,
  value,
  groups,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  groups: Option[][];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const current = groups.flat().find((o) => o.value === value);
  return (
    <div className="relative min-w-0">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            type="button"
            aria-label={label}
            title={label}
            data-export-menu={id}
            className={cn(
              fieldShell,
              // Purple ring while the menu is open (G2-scale-menu); keyboard focus only otherwise.
              "w-full justify-between pr-2.5 text-left outline-none focus-within:ring-0 focus-visible:ring-1 focus-visible:ring-ring aria-expanded:ring-1 aria-expanded:ring-ring disabled:bg-field-disabled disabled:text-field-disabled-foreground disabled:opacity-100",
            )}
          >
            <span className="truncate">{current?.label ?? value}</span>
            <ChevronDown
              aria-hidden
              className="size-3 shrink-0 text-muted-foreground group-aria-expanded/field:rotate-180 group-disabled/field:text-disabled-glyph"
            />
          </button>
        </DropdownMenuTrigger>
        {/* 152px wide, 24px rows (G2-format-menu); the inset is the shared menu surface, as in the constraints menu. */}
        <DropdownMenuContent align="start" collisionPadding={2} className="w-38">
          {groups.map((group, g) => (
            <Fragment key={g}>
              {g ? <DropdownMenuSeparator /> : null}
              {group.map((o) => (
                <DropdownMenuItem
                  key={o.value}
                  data-export-option={o.value}
                  className="h-6"
                  onSelect={() => onChange(o.value)}
                >
                  <span className="flex-1">{o.label}</span>
                  {o.value === value ? (
                    <Check className="size-3.5 text-foreground" aria-hidden />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <select
        id={id}
        aria-hidden
        tabIndex={-1}
        value={value}
        disabled={disabled}
        className="pointer-events-none absolute inset-0 size-full opacity-0"
        onChange={(event) => onChange(event.target.value)}
      >
        {groups.flat().map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ExportSection({
  doc,
  node,
  selection,
}: {
  doc: DesignDocument;
  node: Node;
  selection: string[];
}) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("PNG");
  const [flavor, setFlavor] = useState<CodeFlavor>("tailwind");
  const [scale, setScale] = useState("2");
  const [scope, setScope] = useState("selection");
  const [name, setName] = useState<string | null>(null);
  const [suffix, setSuffix] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [options, setOptions] = useState(false);
  // A different layer starts closed with its own name (adjusted during render, not in an effect).
  const [shownId, setShownId] = useState(node.id);
  if (shownId !== node.id) {
    setShownId(node.id);
    setOpen(false);
    setName(null);
    setStatus("");
    setOptions(false);
  }
  const exported = exportedNodes(doc, selection, scope === "selection");
  const formats = exportFormats(exported.length > 0 && exported.every(isSvgNode));
  // SVG disappears when the selection gains a non-SVG layer: fall back to PNG.
  const active = formats.some((f) => f.value === format) ? format : "PNG";
  const unscaled = UNSCALED.has(active);
  const fileName = name ?? node.name;
  const fileSuffix = suffix ?? (unscaled ? "" : defaultSuffix(scale));
  const customised = suffix !== null || scope !== "selection";
  const label =
    active === "CODE"
      ? (CODE_FLAVORS.find((f) => f.value === flavor)?.label ?? "Code")
      : (formats.find((f) => f.value === active)?.label ?? active);
  const run = async () => {
    setBusy(true);
    setStatus("");
    try {
      const count = exported.length;
      const saved = await exportArtwork({
        format: active,
        flavor,
        scale: unscaled ? "1" : scale,
        selectionOnly: scope === "selection",
        name: fileName,
        suffix: fileSuffix,
      });
      if (!saved) return; // save dialog cancelled
      const message = `Exported ${count} ${count === 1 ? "element" : "elements"}`;
      setStatus(`${message} · ${saved}`);
      toast.success(message, { id: "artwork-export", description: saved });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
      toast.error("Export failed", { id: "artwork-export", description: message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <OptionalSection
      id="export-section"
      title="Export"
      present={open}
      onAdd={() => setOpen(true)}
      onRemove={() => setOpen(false)}
      // Wonder G2-added: the PNG export section is 136px from divider to divider (11px under the button).
      bodyClassName="pb-2.75"
    >
      {/* The options popover is anchored to the whole name field so it opens beside the panel. */}
      <Popover open={options} onOpenChange={setOptions} modal={false}>
        <PopoverAnchor asChild>
          <div className="flex min-w-0 flex-col">
            <Field
              label="Export file name"
              value={fileName}
              onCommit={(value) => setName(value.trim() || null)}
              suffix={
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    id="artwork-options"
                    aria-label="Export options"
                    title="Export options"
                    data-custom={customised || undefined}
                    className="-mr-1 flex size-5 items-center justify-center rounded-sm text-muted-foreground opacity-0 group-hover/field:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring data-custom:opacity-100 data-[state=open]:opacity-100"
                  >
                    <SlidersHorizontal className="size-3.5" aria-hidden />
                  </button>
                </PopoverTrigger>
              }
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          side="left"
          align="start"
          sideOffset={20}
          collisionPadding={8}
          className="w-56"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="flex flex-col gap-2">
            <Caption label="Suffix">
              <Field
                label="Export file suffix"
                value={fileSuffix}
                placeholder="None"
                onCommit={(value) => setSuffix(value.trim())}
              />
            </Caption>
            <Caption label="Export">
              <NativeSelect
                id="artwork-scope"
                label="Export scope"
                value={scope}
                onChange={setScope}
                options={[
                  { value: "selection", label: "Selection" },
                  { value: "page", label: "Whole page" },
                ]}
              />
            </Caption>
          </div>
        </PopoverContent>
      </Popover>
      <div className="grid grid-cols-2 gap-2">
        <MenuSelect
          id="artwork-scale"
          label="Export size"
          value={unscaled ? "1" : scale}
          disabled={unscaled}
          onChange={(value) => {
            setScale(value);
            setSuffix(null);
          }}
          groups={scaleGroups(EXPORT_SCALES)}
        />
        <MenuSelect
          id="artwork-format"
          label="Export format"
          value={active}
          onChange={(value) => setFormat(value as ExportFormat)}
          groups={[formats]}
        />
      </div>
      {active === "CODE" ? (
        <NativeSelect
          id="artwork-code"
          label="Code flavor"
          value={flavor}
          onChange={(value) => setFlavor(value as CodeFlavor)}
          options={CODE_FLAVORS}
        />
      ) : null}
      <button
        type="button"
        id="artwork-download"
        disabled={busy}
        className="flex h-6 items-center justify-center rounded-md bg-input text-xs text-foreground shadow-field hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        onClick={run}
      >
        {busy ? "Exporting…" : `Export as ${label}`}
      </button>
      <p
        id="artwork-status"
        role="status"
        className="truncate text-2xs text-subtle-foreground empty:hidden"
        title={status}
      >
        {status}
      </p>
    </OptionalSection>
  );
}
