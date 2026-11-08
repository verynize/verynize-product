import { alreadyReported, prepareImage } from "@/lib/image-upload";
// Masks (design/wonder/2026-10-30/18–21, validation/v09, extra/52): Linear / Radial / Conic fades, an embedded
// Image or a Custom CSS gradient, each with alpha, rotation, invert and visibility, plus Advanced options
// (Mode, Repeat, Position, Size) and how the mask combines with the masks below it (Add, Subtract, Intersect,
// Exclude). "Detach mask as shape" turns a mask into a separate layer. Several masks stack as mask-image
// layers (web/node-style.js). The free-form CSS mask field (`[name=mask]`) shows only for older documents that
// still carry `node.mask`; new CSS masks use the Custom type (`[name=mask-<i>-css]`).
// Shape masks (`type: "shape"`, made by "Use as mask", Wonder P5-mask-inspector) show as one row: frame icon, the
// editable inset() field (`[name=mask-<i>-shape]`), Detach mask as shape, Remove mask (shape-mask.ts).
import { useState } from "react";
import {
  ChevronDown,
  Circle,
  CircleDot,
  Columns2,
  CopyPlus,
  Frame,
  Image as ImageIcon,
  Spline,
  SquareDashedBottom,
} from "lucide-react";
import { activePage } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { CheckField } from "./check-field";
import { Affix, Caption, Field, IconButton, NativeSelect, Segmented } from "./controls";
import {
  ListSection,
  RowTools,
  editList,
  listOf,
  readNumber,
  type EffectProps,
  type Mask,
  type MaskType,
} from "./effects";
import { notify } from "./legacy";
import { RemoveIcon } from "@/components/icons";
import { detachShapeMask, isShapeInset, removeMask } from "./shape-mask";
import { fmt, setField, type Node } from "./model";

const MASK_LABEL: Record<MaskType, string> = {
  linear: "Linear",
  radial: "Radial",
  conic: "Conic",
  image: "Image",
  custom: "Custom",
  shape: "Shape",
};
const MASK_ICON = {
  linear: Columns2,
  radial: Circle,
  conic: CircleDot,
  image: ImageIcon,
  custom: Spline,
  shape: Frame,
};
const MODES = [
  { value: "auto", label: "Auto" },
  { value: "alpha", label: "Alpha" },
  { value: "luminance", label: "Luminance" },
];
const REPEATS = [
  { value: "repeat", label: "Repeat" },
  { value: "no-repeat", label: "No repeat" },
  { value: "repeat-x", label: "Repeat X" },
  { value: "repeat-y", label: "Repeat Y" },
  { value: "space", label: "Space" },
  { value: "round", label: "Round" },
];
const COMPOSITES = [
  { value: "add", label: "Add" },
  { value: "subtract", label: "Subtract" },
  { value: "intersect", label: "Intersect" },
  { value: "exclude", label: "Exclude" },
];
const SIZE = /^(auto|cover|contain|\d{1,5}(\.\d{1,3})?(px|%)( \d{1,5}(\.\d{1,3})?(px|%))?)$/;
const GRADIENT = /^(repeating-)?(linear|radial|conic)-gradient\(.+\)$/i;
const DEFAULT_CUSTOM = "radial-gradient(circle, black 50%, transparent 51%)";

/** Ask for an image file and return it as an embedded data URL. */
function pickMaskImage(onPick: (src: string) => void) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = window.imageUpload.ACCEPT;
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      onPick((await prepareImage(file)).src);
    } catch (error) {
      if (!alreadyReported(error)) notify(error instanceof Error ? error.message : String(error));
    }
  };
  input.click();
}

const hex2 = (alpha: number) =>
  Math.round((Math.min(100, Math.max(0, alpha)) / 100) * 255)
    .toString(16)
    .padStart(2, "0");

/** The paint a detached mask becomes: the same fade/image as a fill of a new layer. */
function maskPaint(mask: Mask): Record<string, unknown> {
  const solid = "#000000" + hex2(mask.alpha ?? 100);
  const [from, to] = mask.invert ? ["#00000000", solid] : [solid, "#00000000"];
  const stops = [
    { position: 0, color: from },
    { position: 100, color: to },
  ];
  if (mask.type === "image")
    return {
      fills: [
        {
          type: "image",
          src: mask.src,
          fit: mask.size === "cover" || mask.size === "contain" ? mask.size : "fill",
        },
      ],
    };
  if (mask.type === "custom") return { gradient: mask.css ?? "" };
  if (mask.type === "radial") return { fills: [{ type: "radial", stops }] };
  return { fills: [{ type: mask.type, angle: mask.rotation ?? 0, stops }] };
}

const SHAPE_DROP = [
  "masks",
  "shadows",
  "filters",
  "fills",
  "bindings",
  "cornerRadii",
  "strokeWidths",
  "strokeColors",
  "strokeToken",
  "outlineWidth",
  "outlineOffset",
  "outlineColor",
  "outlineStyle",
  "outlineToken",
  "blendMode",
  "src",
  "icon",
  "svgPaints",
  "svgColor",
  "svgColorToken",
  "objectFit",
];

/**
 * "Detach mask as shape": remove the mask from the layer and add a rectangle with the same bounds right
 * above it whose fill is the mask (one undo step). The new layer is selected.
 */
export function detachMaskAsShape(nodeId: string, index: number) {
  const doc = window.design.getDocument();
  const page = activePage(doc);
  const nodes = page.nodes as Node[];
  const at = nodes.findIndex((n) => n.id === nodeId);
  const source = nodes[at] as Node & { masks?: Mask[]; position?: string };
  const mask = source?.masks?.[index];
  if (!source || !mask) return;
  const parent = nodes.find((n) => n.id === source.parentId);
  const shape: Record<string, unknown> = {
    ...structuredClone(source),
    id: crypto.randomUUID(),
    type: "rectangle",
    name: `${source.name} mask`,
    color: "transparent",
    token: "",
    text: "",
    textRuns: [],
    gradient: "",
    mask: "",
    shadow: "",
    strokeWidth: 0,
    hidden: undefined,
    locked: undefined,
  };
  for (const key of SHAPE_DROP) delete shape[key];
  Object.assign(shape, maskPaint(mask));
  // A layer inside an auto layout keeps the source's place without pushing its siblings.
  if (parent && parent.layout && parent.layout !== "free") shape.position = "absolute";
  const masks = source.masks!.filter((_, i) => i !== index);
  if (masks.length) source.masks = masks;
  else delete source.masks;
  nodes.splice(at + 1, 0, shape as Node);
  try {
    window.design.setDocument(doc);
    window.design.setSelection([shape.id as string]);
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
  }
}

export function MaskSection({ node, selection }: EffectProps) {
  const masks = listOf<Mask>(node, "masks");
  const [editing, setEditing] = useState<number | null>(null);
  const edit = (fn: (list: Mask[]) => Mask[]) => editList<Mask>(selection, node, "masks", fn);
  // Wonder A6: the body exists only while there are masks; removing the last one collapses to the header.
  const hasBody = masks.length > 0 || !!node.mask;
  return (
    <ListSection
      id="mask-section"
      title="Mask"
      addLabel="Add mask"
      variant="rows"
      onAdd={() => {
        edit((list) => [...list, { type: "linear", rotation: 180, alpha: 100 }]);
        setEditing(masks.length);
      }}
    >
      {hasBody ? (
        <>
          {masks.map((mask, index) =>
            mask.type === "shape" ? (
              <ShapeMaskRow key={index} index={index} node={node} mask={mask} edit={edit} />
            ) : (
              <MaskRow
                key={index}
                index={index}
                node={node}
                mask={mask}
                open={editing === index}
                onOpenChange={(open) => setEditing(open ? index : null)}
                edit={edit}
              />
            ),
          )}
          {node.mask ? (
            <Caption label="Custom mask (CSS)">
              <Field
                name="mask"
                label="Mask gradient (CSS)"
                value={node.mask}
                placeholder="linear-gradient(black, transparent)"
                onCommit={(value) => setField(selection, node, "mask", value)}
              />
            </Caption>
          ) : null}
        </>
      ) : null}
    </ListSection>
  );
}

/** Wonder P5-mask-inspector: [frame icon] [inset(…) field] [detach] [remove]. */
function ShapeMaskRow({
  index,
  node,
  mask,
  edit,
}: {
  index: number;
  node: Node;
  mask: Mask;
  edit: (fn: (list: Mask[]) => Mask[]) => void;
}) {
  return (
    <div className="flex items-center gap-2" data-mask-row={index} data-mask-type="shape">
      <Frame className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <Field
        name={`mask-${index}-shape`}
        label="Mask shape"
        className="min-w-0 flex-1"
        value={mask.shape ?? ""}
        onCommit={(raw) => {
          const shape = raw.trim().replace(/\s+/g, " ");
          if (!isShapeInset(shape))
            return "Use inset() with percentages, such as inset(10% 10% 10% 10%)";
          edit((list) => list.map((item, i) => (i === index ? { ...item, shape } : item)));
        }}
      />
      <IconButton
        icon={CopyPlus}
        label="Detach mask as shape"
        data-mask-detach={index}
        onClick={() => detachShapeMask(node.id, index)}
      />
      <IconButton
        icon={RemoveIcon}
        label="Remove mask"
        data-effect-tool="remove"
        onClick={() => removeMask(node.id, index)}
      />
    </div>
  );
}

function MaskRow({
  index,
  node,
  mask,
  open,
  onOpenChange,
  edit,
}: {
  index: number;
  node: Node;
  mask: Mask;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  edit: (fn: (list: Mask[]) => Mask[]) => void;
}) {
  const [advanced, setAdvanced] = useState(
    !!(mask.mode || mask.repeat || mask.x || mask.y || mask.size),
  );
  const update = (patch: Partial<Mask>) =>
    edit((list) =>
      list.map((item, i) => {
        if (i !== index) return item;
        const next: Mask = { ...item, ...patch };
        for (const key of Object.keys(next) as (keyof Mask)[])
          if (next[key] === undefined || next[key] === false) delete next[key];
        if (next.type !== "image") delete next.src;
        if (next.type !== "custom") delete next.css;
        if (next.mode === "auto") delete next.mode;
        if (next.repeat === "repeat") delete next.repeat;
        if (next.composite === "add") delete next.composite;
        if (next.size === "auto") delete next.size;
        if (!next.x) delete next.x;
        if (!next.y) delete next.y;
        return next;
      }),
    );
  const setType = (type: MaskType) => {
    if (type === mask.type) return;
    if (type === "image") pickMaskImage((src) => update({ type, src }));
    else if (type === "custom") update({ type, css: mask.css ?? DEFAULT_CUSTOM });
    else update({ type });
  };
  const label = MASK_LABEL[mask.type] ?? "Linear";
  const Icon = MASK_ICON[mask.type] ?? Columns2;
  const gradient = mask.type === "linear" || mask.type === "radial" || mask.type === "conic";
  return (
    <Popover open={open} onOpenChange={onOpenChange} modal={false}>
      <div className="flex items-center gap-2" data-mask-row={index} data-mask-type={mask.type}>
        <PopoverAnchor asChild>
          <button
            type="button"
            data-mask-edit={index}
            aria-expanded={open}
            data-hidden={mask.hidden === true}
            className="flex h-6 min-w-0 flex-1 items-center gap-2 rounded-md bg-input pr-2 pl-1.5 text-left text-xs text-foreground shadow-field hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring data-[hidden=true]:text-muted-foreground"
            onClick={() => onOpenChange(!open)}
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{label}</span>
            {mask.composite && mask.composite !== "add" ? (
              <span className="ml-auto text-muted-foreground">
                {COMPOSITES.find((c) => c.value === mask.composite)?.label}
              </span>
            ) : null}
          </button>
        </PopoverAnchor>
        <RowTools
          label={label.toLowerCase() + " mask"}
          hidden={mask.hidden === true}
          onToggle={() => update({ hidden: !mask.hidden })}
          onRemove={() => {
            onOpenChange(false);
            edit((list) => list.filter((_, i) => i !== index));
          }}
        />
      </div>
      <PopoverContent
        id="mask-editor"
        data-mask-editor={index}
        side="left"
        align="start"
        sideOffset={16}
        collisionPadding={8}
        className="w-64"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if ((event.target as HTMLElement | null)?.closest?.("[data-mask-edit]"))
            event.preventDefault();
        }}
      >
        <div className="flex flex-col gap-2">
          <div className="text-xs text-foreground">{label}</div>
          <Segmented
            label="Mask type"
            value={mask.type}
            dataKey="mask-type"
            items={(["linear", "radial", "conic", "image", "custom"] as const).map((type) => ({
              value: type,
              label: MASK_LABEL[type],
              icon: MASK_ICON[type],
            }))}
            onChange={(type) => setType(type as MaskType)}
          />
          {mask.type === "image" && mask.src ? (
            <div className="flex items-center gap-2">
              <img
                src={mask.src}
                alt="Mask source"
                className="size-12 shrink-0 rounded-md bg-muted object-contain"
              />
              <button
                type="button"
                className="flex h-6 flex-1 items-center justify-center gap-1 rounded-md bg-input text-xs text-foreground shadow-field hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => pickMaskImage((src) => update({ src }))}
              >
                <ImageIcon className="size-3.5" aria-hidden />
                Replace image…
              </button>
            </div>
          ) : null}
          {mask.type === "custom" ? (
            <Caption label="Gradient (CSS)">
              <Field
                name={`mask-${index}-css`}
                label="Custom mask gradient"
                value={mask.css ?? ""}
                placeholder={DEFAULT_CUSTOM}
                onCommit={(raw) => {
                  const css = raw.trim();
                  if (!GRADIENT.test(css) || /url\s*\(|[;{}<>\\]/i.test(css))
                    return "Use a CSS gradient such as radial-gradient(black, transparent)";
                  update({ css });
                }}
              />
            </Caption>
          ) : null}
          {gradient ? (
            <div className="grid grid-cols-2 gap-2">
              <Caption label="Alpha">
                <Field
                  name={`mask-${index}-alpha`}
                  label="Mask alpha"
                  numeric
                  value={fmt(mask.alpha ?? 100)}
                  prefix={<Affix>A</Affix>}
                  suffix="%"
                  onCommit={(raw) => {
                    const value = readNumber(raw, 0, 100);
                    if (typeof value === "string") return value;
                    update({ alpha: value });
                  }}
                />
              </Caption>
              {mask.type !== "radial" ? (
                <Caption label="Rotation">
                  <Field
                    name={`mask-${index}-rotation`}
                    label="Mask rotation"
                    numeric
                    value={fmt(mask.rotation ?? 0)}
                    prefix={<Affix>R</Affix>}
                    suffix="°"
                    onCommit={(raw) => {
                      const value = readNumber(raw, -3600, 3600);
                      if (typeof value === "string") return value;
                      update({ rotation: value });
                    }}
                  />
                </Caption>
              ) : null}
            </div>
          ) : null}
          {gradient ? (
            <CheckField
              name={`mask-${index}-invert`}
              label="Invert"
              checked={mask.invert === true}
              onChange={(invert) => update({ invert })}
            />
          ) : null}
          <NativeSelect
            name={`mask-${index}-composite`}
            label="Combine with masks below"
            value={mask.composite ?? "add"}
            options={COMPOSITES}
            onChange={(value) => update({ composite: value as Mask["composite"] })}
          />
          <button
            type="button"
            aria-expanded={advanced}
            data-mask-advanced={index}
            className="flex h-6 items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => setAdvanced(!advanced)}
          >
            <ChevronDown className={cn("size-3", !advanced && "-rotate-90")} aria-hidden />
            Advanced
          </button>
          {advanced ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Caption label="Mode">
                  <NativeSelect
                    name={`mask-${index}-mode`}
                    label="Mask mode"
                    value={mask.mode ?? "auto"}
                    options={MODES}
                    onChange={(value) => update({ mode: value as Mask["mode"] })}
                  />
                </Caption>
                <Caption label="Repeat">
                  <NativeSelect
                    name={`mask-${index}-repeat`}
                    label="Mask repeat"
                    value={mask.repeat ?? "repeat"}
                    options={REPEATS}
                    onChange={(value) => update({ repeat: value })}
                  />
                </Caption>
              </div>
              <Caption label="Position">
                <div className="grid grid-cols-2 gap-2">
                  {(["x", "y"] as const).map((axis) => (
                    <Field
                      key={axis}
                      name={`mask-${index}-${axis}`}
                      label={`Mask position ${axis.toUpperCase()}`}
                      numeric
                      value={fmt(mask[axis] ?? 0)}
                      prefix={<Affix>{axis.toUpperCase()}</Affix>}
                      suffix="%"
                      onCommit={(raw) => {
                        const value = readNumber(raw, -10000, 10000);
                        if (typeof value === "string") return value;
                        update({ [axis]: value });
                      }}
                    />
                  ))}
                </div>
              </Caption>
              <Caption label="Size">
                <Field
                  name={`mask-${index}-size`}
                  label="Mask size"
                  value={mask.size ?? "auto"}
                  placeholder="auto"
                  onCommit={(raw) => {
                    const size = raw.trim().replace(/\s+/g, " ") || "auto";
                    if (!SIZE.test(size))
                      return "Use auto, cover, contain, 50% or 120px (one or two values)";
                    update({ size });
                  }}
                />
              </Caption>
            </>
          ) : null}
          <button
            type="button"
            data-mask-detach={index}
            className="flex h-6 items-center justify-center gap-1 rounded-md bg-input text-xs text-foreground shadow-field hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => {
              onOpenChange(false);
              detachMaskAsShape(node.id, index);
            }}
          >
            <SquareDashedBottom className="size-3.5" aria-hidden />
            Detach mask as shape
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
