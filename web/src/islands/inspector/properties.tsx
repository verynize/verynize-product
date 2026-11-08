// Properties sections (design/wonder 22, 25, 43, 45–46, 55–56).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  ChevronDown,
  Expand,
  Eye,
  RotateCcw,
  Scan,
  Check,
} from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { activePage, type DesignDocument } from "@/lib/bridge";
import {
  AbsolutePositionIcon,
  AlignBottomBarsIcon,
  AlignCenterXBarsIcon,
  AlignLeftBarsIcon,
  AlignMiddleYBarsIcon,
  AlignRightBarsIcon,
  AlignTopBarsIcon,
  AngleIcon,
  ClosedEyeIcon,
  CornerBottomLeftIcon,
  CornerBottomRightIcon,
  CornerTopLeftIcon,
  CornerTopRightIcon,
  FlipHorizontalIcon,
  FlipVerticalIcon,
  OpacityIcon,
  RotateRightIcon,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import {
  Affix,
  Caption,
  Field,
  fieldShell,
  IconAffix,
  IconButton,
  NativeSelect,
  Section,
  Swatch,
  type IconType,
} from "./controls";
import { formClick, notify } from "./legacy";
import { Tip } from "../chrome/tip";
import { ColorPopover } from "./color-picker";
import { BindableField } from "./bind";
import { CORNER_KEYS } from "./vars";
import { ExportSection } from "./export-section";
import { FramePresetsSection, useCanvasTool } from "./frame-presets";
import {
  isPreviewFrame,
  PreviewAppearanceSection,
  PreviewLayoutSection,
  PreviewTemplateSection,
} from "./preview-frame";
import { ScaleSection } from "./scale";
import { ComponentSection } from "./component";
import { FillTools, PaintStack, hasPaintRows } from "./paints";
import { parseColor, toHex } from "./color";
import { fmt, hexLabel, pageNodes, parseHex, patchNodes, setField, type Node } from "./model";
import { TypographySection } from "./typography";
import { SelectionColorsSection } from "./selection-colors";
import {
  MixedSection,
  SelectionFilters,
  mixedFills,
  mixedFilters,
  mixedShadows,
  replaceFills,
  replaceList,
} from "./multi-select";
import { LayoutSection } from "./layout";
import { ConstraintSelect, ConstraintWidget, readConstraints } from "./constraints";
import { BlendMenu, OutlineSection } from "./effects";
import { ShadowSection } from "./shadows";
import { FilterSection } from "./filters";
import { MaskSection } from "./masks";
import { BorderSection } from "./border-colors";
import { VectorStrokeSection } from "./vector-stroke";
import {
  ShaderFill,
  ShaderParameters,
  ShaderPicker,
  isParam,
  shaderPresetName,
  shaderPresets,
} from "./shader-library";

type Props = { doc: DesignDocument; node: Node; selection: string[] };

/* ---------- Position ---------- */
export const ALIGN_GROUPS: { id: string; label: string; icon: IconType }[][] = [
  [
    { id: "left", label: "Align left", icon: AlignLeftBarsIcon },
    { id: "center", label: "Align horizontal centers", icon: AlignCenterXBarsIcon },
    { id: "right", label: "Align right", icon: AlignRightBarsIcon },
  ],
  [
    { id: "top", label: "Align top", icon: AlignTopBarsIcon },
    { id: "middle", label: "Align vertical centers", icon: AlignMiddleYBarsIcon },
    { id: "bottom", label: "Align bottom", icon: AlignBottomBarsIcon },
  ],
];

export function ToolGroup({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  return (
    <div
      role="group"
      className={cn(
        // Wonder C1: three 24px buttons spread evenly (glyph centres 13 / 40 / 67 px into the 80px group).
        "flex h-6 items-center justify-around rounded-md bg-muted",
        disabled && "bg-muted/50",
      )}
    >
      {children}
    </div>
  );
}

export function ToolButton({
  id,
  label,
  icon: Icon,
  disabled,
  onClick,
}: {
  id?: string;
  label: string;
  icon: IconType;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      id={id}
      aria-label={label}
      title={label}
      disabled={disabled}
      className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:text-subtle-foreground disabled:opacity-40"
      onClick={onClick}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

const isFlowFrame = (n: Node | undefined) => !!n && (n.layout || "free") !== "free";
const canvasLayer = (id: string) =>
  document.querySelector<HTMLElement>(`#canvas [data-id="${CSS.escape(id)}"]`);
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Align one layer to its parent (Wonder C1: with a single positioned child selected the align tools target the
 * parent). Children of free frames keep x/y inside the parent's border; absolute children of flow frames measure
 * from its border box (see `containing()` in web/canvas-interactions.js). Anchored layers keep their constraint.
 */
function alignToParent(node: Node, parent: Node, mode: string) {
  const parentEl = canvasLayer(parent.id),
    el = canvasLayer(node.id);
  if (!parentEl || !el) return;
  const flow = isFlowFrame(parent);
  const horizontal = mode === "left" || mode === "center" || mode === "right";
  const offset = flow ? (horizontal ? parentEl.clientLeft : parentEl.clientTop) : 0;
  const room = horizontal ? parentEl.clientWidth : parentEl.clientHeight;
  const size = horizontal ? el.offsetWidth : el.offsetHeight;
  const at =
    mode === "left" || mode === "top"
      ? 0
      : mode === "right" || mode === "bottom"
        ? room - size
        : (room - size) / 2;
  patchNodes([node.id], () => ({ [horizontal ? "x" : "y"]: round2(offset + at) }));
}

/**
 * The Position header's absolute toggle (Wonder C1/B4): takes children of a flow (flex/grid/block) frame out of the
 * flow as `position: 'absolute'` — which enables constraints — or puts them back. The layer keeps its place on the
 * canvas: x/y become its current offset from the parent's border box.
 */
function toggleAbsolute(doc: DesignDocument, selection: string[], on: boolean) {
  const nodes = pageNodes(doc);
  const ids = selection.filter((id) => {
    const n = nodes.find((m) => m.id === id);
    return !!n && !n.locked && isFlowFrame(nodes.find((m) => m.id === n.parentId));
  });
  if (!ids.length) return;
  patchNodes(ids, (n) => {
    if (!on)
      return {
        position: undefined,
        inset: undefined,
        translate: undefined,
        wPct: undefined,
        hPct: undefined,
      };
    const el = canvasLayer(n.id),
      parentEl = n.parentId ? canvasLayer(n.parentId) : null;
    const patch: Record<string, unknown> = { position: "absolute" };
    if (el && parentEl && el.offsetParent === parentEl) {
      patch.x = round2(el.offsetLeft + parentEl.clientLeft);
      patch.y = round2(el.offsetTop + parentEl.clientTop);
    }
    // Fill only means something inside the flow; keep the rendered size instead.
    if (n.wMode === "fill")
      Object.assign(patch, { wMode: undefined, w: el ? el.offsetWidth : n.w });
    if (n.hMode === "fill")
      Object.assign(patch, { hMode: undefined, h: el ? el.offsetHeight : n.h });
    return patch;
  });
}

/**
 * The Position header's expand tool, Wonder's "Resize to fill" (⌘⇧⌥F): flow frames hug both axes; a free frame
 * takes the bounds of its visible children (which keep their place on the canvas). Matches Wonder H1-parent-after
 * (the parent shrinks and moves around its child) and H1-flex-after (an already-fitting flex parent stays put).
 */
function fitToContent(doc: DesignDocument, frame: Node) {
  const kids = pageNodes(doc).filter((n) => n.parentId === frame.id && !n.hidden);
  if (!kids.length) return;
  if (isFlowFrame(frame)) {
    patchNodes([frame.id], () => ({
      wMode: "hug",
      hMode: "hug",
      wPct: undefined,
      hPct: undefined,
    }));
    return;
  }
  const el = canvasLayer(frame.id);
  const bordersX = el ? el.offsetWidth - el.clientWidth : 0,
    bordersY = el ? el.offsetHeight - el.clientHeight : 0;
  const size = (n: Node, axis: "w" | "h") => {
    const box = canvasLayer(n.id);
    return box ? (axis === "w" ? box.offsetWidth : box.offsetHeight) : Number(n[axis]) || 0;
  };
  const x0 = Math.min(...kids.map((n) => n.x)),
    y0 = Math.min(...kids.map((n) => n.y));
  const x1 = Math.max(...kids.map((n) => n.x + size(n, "w"))),
    y1 = Math.max(...kids.map((n) => n.y + size(n, "h")));
  const moved = new Set(kids.map((n) => n.id));
  patchNodes([frame.id, ...moved], (n) =>
    n.id === frame.id
      ? {
          x: round2(n.x + x0),
          y: round2(n.y + y0),
          w: round2(Math.max(1, x1 - x0 + bordersX)),
          h: round2(Math.max(1, y1 - y0 + bordersY)),
          wMode: undefined,
          hMode: undefined,
          wPct: undefined,
          hPct: undefined,
        }
      : { x: round2(n.x - x0), y: round2(n.y - y0) },
  );
}

function PositionSection({ doc, node, selection }: Props) {
  const set = (key: string) => (value: string) => setField(selection, node, key, value);
  const many = selection.length > 1;
  const nodes = pageNodes(doc);
  const parent = node.parentId ? nodes.find((n) => n.id === node.parentId) : undefined;
  const selected = nodes.filter((n) => selection.includes(n.id));
  // Children of flow frames can be taken out of the flow; children of free frames are always positioned.
  const flowChildren = selected.filter(
    (n) => !!n.parentId && isFlowFrame(nodes.find((m) => m.id === n.parentId)),
  );
  const absolute = flowChildren.length > 0 && flowChildren.every((n) => n.position === "absolute");
  const inFlow = !!parent && isFlowFrame(parent) && node.position !== "absolute";
  // One layer: align it to its parent unless the flow places it (Wonder dims the tools for top-level layers and
  // in-flow children). Several layers: align them to each other.
  const alignToParentOk = !many && !!parent && !inFlow && !node.locked;
  const alignEnabled = many || alignToParentOk;
  const align = (id: string) =>
    many ? formClick("precision-" + id) : parent && alignToParent(node, parent, id);
  const fitEnabled =
    !many && node.type === "frame" && nodes.some((n) => n.parentId === node.id && !n.hidden);
  const constraints = readConstraints(selection);
  // ⌘⇧⌥F runs the expand tool (Wonder's shortcut) while the canvas, not a field, has the keyboard.
  // Captured on window so ⌘⇧F (global search) does not also see it.
  const fit = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    fit.current = fitEnabled ? () => fitToContent(doc, node) : null;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "KeyF" || !event.shiftKey || !event.altKey || event.repeat) return;
      if (!(navigator.platform.includes("Mac") ? event.metaKey : event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, select, [contenteditable=true]") || !fit.current)
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      fit.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const tools = (
    <>
      {/* Wonder H1-tooltip: "Resize to fill ⌘⇧⌥F" (the parent shrinks and moves around its children). */}
      <Tip label="Resize to fill" shortcut="⌘⇧⌥F">
        <IconButton
          id="position-fit-content"
          icon={Expand}
          label="Resize to fill"
          title={undefined}
          aria-keyshortcuts="Meta+Shift+Alt+F"
          disabled={!fitEnabled}
          className="disabled:opacity-50"
          onClick={() => fitToContent(doc, node)}
        />
      </Tip>
      {node.parentId ? (
        <IconButton
          id="position-absolute"
          icon={AbsolutePositionIcon}
          label={absolute ? "Return to layout flow" : "Absolute position"}
          aria-pressed={absolute || !flowChildren.length}
          disabled={!flowChildren.length}
          className="aria-pressed:bg-toggle-on aria-pressed:text-toggle-on-foreground disabled:opacity-50"
          onClick={() => toggleAbsolute(doc, selection, !absolute)}
        />
      ) : null}
    </>
  );
  return (
    <Section
      id="position-section"
      // Wonder A9-selection-colors-multiple: a multi-selection names its size in place of "Position".
      title={selection.length > 1 ? `${selection.length} nodes selected` : "Position"}
      tools={tools}
    >
      <div className="grid grid-cols-3 gap-2">
        {ALIGN_GROUPS.map((group) => (
          <ToolGroup key={group[0]?.id} disabled={!alignEnabled}>
            {group.map((b) => (
              <ToolButton
                key={b.id}
                id={"precision-" + b.id}
                label={many ? b.label : b.label + " to parent"}
                icon={b.icon}
                disabled={!alignEnabled}
                onClick={() => align(b.id)}
              />
            ))}
          </ToolGroup>
        ))}
        {/* Wonder C1: rotate and flip; distribute takes the flip slots once 3+ layers are selected. */}
        <ToolGroup>
          <ToolButton
            id="position-rotate"
            label="Rotate 90°"
            icon={RotateRightIcon}
            onClick={() =>
              patchNodes(selection, (n) => ({ rotation: ((n.rotation || 0) + 90) % 360 }))
            }
          />
          {selection.length >= 3 ? (
            <>
              <ToolButton
                id="precision-horizontal"
                label="Distribute horizontally"
                icon={AlignHorizontalDistributeCenter}
                onClick={() => align("horizontal")}
              />
              <ToolButton
                id="precision-vertical"
                label="Distribute vertically"
                icon={AlignVerticalDistributeCenter}
                onClick={() => align("vertical")}
              />
            </>
          ) : (
            <>
              <ToolButton
                id="position-flip-h"
                label="Flip horizontal"
                icon={FlipHorizontalIcon}
                onClick={() => window.design.runCommand?.("transform.flipH")}
              />
              <ToolButton
                id="position-flip-v"
                label="Flip vertical"
                icon={FlipVerticalIcon}
                onClick={() => window.design.runCommand?.("transform.flipV")}
              />
            </>
          )}
        </ToolGroup>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field
          name="x"
          label="X position"
          numeric
          value={shared(doc, selection, "x")}
          placeholder="Mixed"
          onCommit={set("x")}
          prefix={<Affix>X</Affix>}
        />
        <Field
          name="y"
          label="Y position"
          numeric
          value={shared(doc, selection, "y")}
          placeholder="Mixed"
          onCommit={set("y")}
          prefix={<Affix>Y</Affix>}
        />
        <Field
          name="rotation"
          label="Rotation"
          numeric
          value={shared(doc, selection, "rotation")}
          placeholder="Mixed"
          onCommit={set("rotation")}
          prefix={<IconAffix icon={AngleIcon} />}
          suffix="°"
          // Wonder TR2: "-47.19" fits the 80px column; tabular figures would overflow it into "-47.…".
          inputClassName="normal-nums"
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <ConstraintSelect axis="h" selection={selection} list={constraints} />
        <ConstraintSelect axis="v" selection={selection} list={constraints} />
        <ConstraintWidget selection={selection} list={constraints} />
        {/* Wonder: "Auto" reads as a value (#e8e8e8), dimmed only while the flow places the layer. */}
        <Field
          name="zIndex"
          label="Stack order"
          numeric
          className={cn("col-span-2", inFlow && !many && "bg-field-disabled")}
          inputClassName="placeholder:text-foreground disabled:placeholder:text-field-disabled-foreground"
          disabled={inFlow && !many}
          value={node.zIndex ? fmt(node.zIndex) : ""}
          placeholder="Auto"
          onCommit={(value) => set("zIndex")(value.trim() || "0")}
          prefix={<Affix>Z</Affix>}
        />
      </div>
    </Section>
  );
}

/** A field value shared by every selected layer, or "" (shown as "Mixed") when they differ. */
function shared(doc: DesignDocument, selection: string[], key: string) {
  const wanted = new Set(selection);
  const values = pageNodes(doc)
    .filter((n) => wanted.has(n.id))
    .map((n) => fmt(n[key]));
  return values.every((v) => v === values[0]) ? (values[0] ?? "") : "";
}

/* ---------- Appearance ---------- */
export function InspectorCheckbox({
  name,
  label,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="m-0 flex h-7 w-fit items-center gap-2 text-xs text-foreground-2/90">
      <CheckboxPrimitive.Root
        name={name}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-input shadow-field focus-visible:ring-1 focus-visible:ring-ring data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
      >
        <CheckboxPrimitive.Indicator>
          <Check className="size-3" data-icon-weight="bold" aria-hidden />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {label}
    </label>
  );
}

function AppearanceSection({ doc, node, selection }: Props) {
  const set = (key: string) => (value: string) => setField(selection, node, key, value);
  const [cornersOpen, setCornersOpen] = useOptional(node.id, Array.isArray(node.cornerRadii));
  const cornersExpanded = cornersOpen && !node.bindings?.radius;
  const corners = individualValues(node, "cornerRadii", "radius");
  const radius = corners.every((value) => value === corners[0]) ? fmt(corners[0]) : "";
  const hidden = !!node.hidden;
  return (
    <Section
      id="appearance-section"
      title="Appearance"
      tools={
        <>
          <IconButton
            id="appearance-visibility"
            icon={hidden ? ClosedEyeIcon : Eye}
            label={hidden ? "Show layer" : "Hide layer"}
            onClick={() => patchNodes(selection, () => ({ hidden: !hidden }))}
          />
          <BlendMenu doc={doc} node={node} selection={selection} />
        </>
      }
    >
      <div className="flex items-end gap-2">
        <Caption label="Opacity" className="flex-1">
          <BindableField
            doc={doc}
            node={node}
            selection={selection}
            field="opacity"
            label="Opacity"
            prefix={<IconAffix icon={OpacityIcon} />}
          >
            {(suffix) => (
              <Field
                name="opacity"
                label="Opacity"
                numeric
                value={shared(doc, selection, "opacity")}
                placeholder="Mixed"
                onCommit={set("opacity")}
                prefix={<IconAffix icon={OpacityIcon} />}
                suffix={<>%{suffix}</>}
              />
            )}
          </BindableField>
        </Caption>
        <Caption label="Corner radius" className="flex-1">
          <BindableField
            doc={doc}
            node={node}
            selection={selection}
            field="radius"
            label="Corner radius"
            prefix={<IconAffix icon={Scan} />}
          >
            {(suffix) => (
              <Field
                name="radius"
                label="Corner radius"
                numeric
                value={radius}
                placeholder="Mixed"
                onCommit={set("radius")}
                prefix={<IconAffix icon={Scan} />}
                suffix={suffix}
              />
            )}
          </BindableField>
        </Caption>
        <IconButton
          icon={Scan}
          label="Independent corner radii"
          active={cornersExpanded}
          aria-expanded={cornersExpanded}
          onClick={() => {
            if (!cornersExpanded) expandIndividual(selection, "cornerRadii", "radius");
            setCornersOpen(!cornersExpanded);
          }}
        />
      </div>
      {cornersExpanded ? (
        <IndividualFields
          doc={doc}
          node={node}
          selection={selection}
          property="cornerRadii"
          scalar="radius"
          labels={[
            "Top left radius",
            "Top right radius",
            "Bottom right radius",
            "Bottom left radius",
          ]}
          prefixes={[
            <CornerTopLeftIcon key="tl" className="size-3.5" />,
            <CornerTopRightIcon key="tr" className="size-3.5" />,
            <CornerBottomRightIcon key="br" className="size-3.5" />,
            <CornerBottomLeftIcon key="bl" className="size-3.5" />,
          ]}
        />
      ) : null}
      {/* Wonder shows Clip content for frames and text layers (properties-audit A8/A10). */}
      {node.type === "frame" || node.type === "text" ? (
        <InspectorCheckbox
          name="clipContent"
          label="Clip content"
          checked={!!node.clipContent}
          onChange={(v) => setField(selection, node, "clipContent", v)}
        />
      ) : null}
    </Section>
  );
}

type IndividualProperty = "cornerRadii" | "strokeWidths";
type UniformProperty = "radius" | "strokeWidth";

function individualValues(
  node: Node,
  property: IndividualProperty,
  scalar: UniformProperty,
): number[] {
  const values = node[property];
  const fallback =
    typeof node[scalar] === "number" && Number.isFinite(node[scalar])
      ? Math.max(0, node[scalar])
      : 0;
  if (Array.isArray(values) && values.length === 4)
    return values.map((value) =>
      typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : fallback,
    );
  return Array.from({ length: 4 }, () => fallback);
}

function individualPatch(
  node: Node,
  property: IndividualProperty,
  scalar: UniformProperty,
  values: number[],
  detach: string[] = [],
) {
  const bindings = { ...node.bindings };
  delete bindings[scalar];
  for (const key of detach) delete bindings[key];
  return { [property]: values, bindings: Object.keys(bindings).length ? bindings : undefined };
}

/** Expanding a bound uniform value starts with four resolved values and detaches only that binding. */
function expandIndividual(
  selection: string[],
  property: IndividualProperty,
  scalar: UniformProperty,
) {
  patchNodes(selection, (node) =>
    individualPatch(node, property, scalar, individualValues(node, property, scalar)),
  );
}

function IndividualFields({
  doc,
  node,
  selection,
  property,
  scalar,
  labels,
  prefixes,
}: {
  doc?: DesignDocument;
  node: Node;
  selection: string[];
  property: IndividualProperty;
  scalar: UniformProperty;
  labels: string[];
  /** Letters or 14px glyphs shown in each field's prefix slot. */
  prefixes: ReactNode[];
}) {
  const values = individualValues(node, property, scalar);
  return (
    <div
      className="grid grid-cols-4 gap-2"
      role="group"
      aria-label={
        property === "cornerRadii" ? "Individual corner radii" : "Individual border widths"
      }
    >
      {labels.map((label, index) => {
        // Each corner radius can bind a Dimension variable; typing a corner detaches only that corner.
        const corner = property === "cornerRadii" ? CORNER_KEYS[index] : undefined;
        const field = (suffix?: ReactNode) => (
          <Field
            name={`${property}-${index}`}
            label={label}
            numeric
            value={fmt(values[index])}
            prefix={<Affix>{prefixes[index]}</Affix>}
            suffix={suffix}
            onCommit={(raw) => {
              const value = Number(raw.trim());
              if (!raw.trim() || !Number.isFinite(value)) return "Enter a number.";
              patchNodes(selection, (selected) => {
                const next = individualValues(selected, property, scalar);
                next[index] = Math.max(0, value);
                return individualPatch(selected, property, scalar, next, corner ? [corner] : []);
              });
            }}
          />
        );
        return corner && doc ? (
          <BindableField
            key={label}
            doc={doc}
            node={node}
            selection={selection}
            field={corner}
            label={label}
            prefix={<Affix>{prefixes[index]}</Affix>}
          >
            {field}
          </BindableField>
        ) : (
          <div key={label} className="contents">
            {field()}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Fill ---------- */
/** Always mounted: app.js toggles `#shader-settings.hidden` on every render, even with nothing selected. */
function ShaderSettings({ node, selection }: { node: Node | undefined; selection: string[] }) {
  const shader = node?.type === "shader";
  const set = (key: string) => (value: string) => node && setField(selection, node, key, value);
  const preset = shaderPresetName(node?.shaderPreset);
  const [picker, setPicker] = useState(false);
  return (
    <details id="shader-settings" hidden={!shader} className="group/shader m-0 border-0 p-0">
      <summary className="flex h-6 cursor-default list-none items-center justify-between rounded-md bg-input px-2 text-xs text-foreground shadow-field hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring">
        <span className="truncate">{preset}</span>
        <span className="text-muted-foreground group-open/shader:rotate-180">
          <ChevronDown className="size-3" aria-hidden />
        </span>
      </summary>
      {node ? (
        <div className="flex flex-col gap-2 pt-2">
          <Caption label="Preset">
            <NativeSelect
              name="shaderPreset"
              label="Shader preset"
              value={node.shaderPreset}
              onChange={set("shaderPreset")}
              options={shaderPresets().map((p) => ({ value: p.id, label: p.name }))}
            />
          </Caption>
          <div className="grid grid-cols-2 gap-2">
            <Caption label="Speed">
              <Field
                name="shaderSpeed"
                label="Shader speed"
                numeric
                step={0.1}
                value={fmt(node.shaderSpeed)}
                onCommit={set("shaderSpeed")}
              />
            </Caption>
            <Caption label="Intensity">
              <Field
                name="shaderIntensity"
                label="Shader intensity"
                numeric
                step={0.1}
                value={fmt(node.shaderIntensity)}
                onCommit={set("shaderIntensity")}
              />
            </Caption>
          </div>
          <ShaderPicker node={node} selection={selection} open={picker} onOpenChange={setPicker}>
            <button
              type="button"
              id="choose-shader"
              aria-expanded={picker}
              className="flex h-6 items-center justify-center rounded-md bg-input text-xs text-foreground shadow-field hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => setPicker(!picker)}
            >
              Choose shader…
            </button>
          </ShaderPicker>
          <p className="text-2xs text-subtle-foreground">
            Classic presets follow the fill colour; the other families use their own colours below.
            Speed 0 freezes motion.
          </p>
        </div>
      ) : null}
    </details>
  );
}

const ANIMATED = [
  { value: "", label: "None" },
  { value: "aurora", label: "Aurora" },
  { value: "sunset", label: "Sunset" },
  { value: "ocean", label: "Ocean" },
];

function FillSection({
  doc,
  node,
  selection,
}: {
  doc: DesignDocument;
  node: Node | undefined;
  selection: string[];
}) {
  const set = (key: string) => (value: string) => node && setField(selection, node, key, value);
  return (
    <section id="fill-section" hidden={!node} className="border-b border-border">
      <div className="flex h-7.75 items-center justify-between gap-2 px-3">
        <h3 className="truncate text-xs text-foreground-3">
          {node?.type === "text"
            ? "Text Fill"
            : node?.type === "shader"
              ? "Shader Fill"
              : node?.type === "vector"
                ? "Fill"
                : "Background Fill"}
        </h3>
        {node ? <FillTools doc={doc} node={node} selection={selection} /> : null}
      </div>
      {/* Wonder A1: an empty fill is the 32 px header only; a row starts 5 px under it and ends 12 px above the divider. */}
      <div
        className={cn(
          node && (hasPaintRows(node) || node.gradient || node.animated) ? "flex" : "hidden",
          "flex-col gap-2 px-3 pt-1.25 pb-3",
        )}
      >
        <ShaderSettings node={node} selection={selection} />
        {node ? <ShaderParameters doc={doc} node={node} selection={selection} /> : null}
        {/* Shader mode (H6): preset dropdown + colours in place of the paint rows (Text Fill has no shader mode). */}
        {node && node.type !== "text" && node.type !== "vector" ? (
          <ShaderFill doc={doc} node={node} selection={selection} />
        ) : null}
        {node ? (
          <>
            {/* Parametric shaders take their colours from the rows above; the single fill colour only drives the classic presets. */}
            {node.type === "shader" && isParam(node.shaderPreset) ? null : (
              <PaintStack doc={doc} node={node} selection={selection} />
            )}
            {/* Older animated gradients (`animated`, replaced by Shader mode) keep rendering and stay editable
                until cleared; turning Shader mode on clears them too. */}
            {node.animated ? (
              <div className="grid grid-cols-2 gap-2">
                <Caption label="Animated gradient">
                  <NativeSelect
                    name="animated"
                    label="Animated gradient"
                    value={node.animated}
                    onChange={set("animated")}
                    options={ANIMATED}
                  />
                </Caption>
              </div>
            ) : null}
            {/* Free-form CSS gradients (older documents, codec input) stay editable until cleared. */}
            {node.gradient ? (
              <div className="grid grid-cols-2 gap-2">
                <Caption label="CSS gradient">
                  <Field
                    name="gradient"
                    label="Gradient (CSS)"
                    value={node.gradient}
                    placeholder="linear-gradient(…)"
                    onCommit={set("gradient")}
                  />
                </Caption>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      {/* app.js writes the selected colour here on every render (updateMeasurement). */}
      <input type="hidden" id="fill-hex" />
    </section>
  );
}

/**
 * Wonder A10: a text layer has a Background Fill under its Text Fill, the box painted behind the glyphs. It edits
 * `backgroundFills` (never `color`/`token`); empty, it is the 32 px header only, like every other fill.
 */
function TextBackgroundFillSection({
  doc,
  node,
  selection,
}: {
  doc: DesignDocument;
  node: Node;
  selection: string[];
}) {
  return (
    <section id="text-background-fill-section" className="border-b border-border">
      <div className="flex h-7.75 items-center justify-between gap-2 px-3">
        <h3 className="truncate text-xs text-foreground-3">Background Fill</h3>
        <FillTools doc={doc} node={node} selection={selection} target="backgroundFills" />
      </div>
      {hasPaintRows(node, "backgroundFills") ? (
        <div className="flex flex-col gap-2 px-3 pt-1.25 pb-3">
          <ShaderFill doc={doc} node={node} selection={selection} />
          <PaintStack doc={doc} node={node} selection={selection} target="backgroundFills" />
        </div>
      ) : null}
    </section>
  );
}

/* ---------- Page (nothing selected) ---------- */
const workspace = () => document.getElementById("workspace");

/** The canvas backdrop the page falls back to without its own background (theme token). */
function defaultPageColor() {
  const el = workspace();
  if (!el) return "#2B2B2B";
  const inline = el.style.backgroundColor;
  el.style.backgroundColor = "";
  const parsed = parseColor(getComputedStyle(el).backgroundColor);
  el.style.backgroundColor = inline;
  return parsed ? toHex(parsed) : "#2B2B2B";
}

function updatePage(patch: { background?: string; backgroundHidden?: true }) {
  try {
    window.design.updatePage(patch);
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
  }
}

function PageSection({ doc }: { doc: DesignDocument }) {
  const [open, setOpen] = useState(false);
  const page = activePage(doc) as ReturnType<typeof activePage> & { backgroundHidden?: true };
  const background = page.background;
  const hidden = page.backgroundHidden === true;
  const color = background || defaultPageColor();
  const commit = (next: string) => updatePage({ background: next });
  return (
    // Wonder C8: one paint row (swatch with a 1px ring at x 17–33, hex at x 38, opacity) ending at x 236, then the
    // page-background eye at 256; 15px from the field to the divider.
    <Section id="page-section" title="Page" bodyClassName="pb-3.75">
      <div className="flex items-center gap-2">
        <ColorPopover
          open={open}
          onOpenChange={setOpen}
          value={color}
          onPreview={(next) => {
            const el = workspace();
            if (el) el.style.backgroundColor = next;
          }}
          onCommit={commit}
        >
          <div data-color-anchor className={cn(fieldShell, "group/page flex-1 pl-1.25")}>
            <button
              type="button"
              name="pageBackground"
              aria-label="Page colour"
              aria-expanded={open}
              title="Pick page colour"
              className="flex size-4 shrink-0 items-center justify-center rounded-sm focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => setOpen(!open)}
            >
              <Swatch
                color={color}
                checker={hidden}
                className="size-4 rounded-sm ring-swatch-ring"
              />
            </button>
            <Field
              label="Page hex colour"
              value={hexLabel(color)}
              className="h-5 flex-1 bg-transparent px-0 shadow-none focus-within:ring-0"
              inputClassName={cn("uppercase", hidden && "text-muted-foreground")}
              onCommit={(value) => {
                const hex =
                  parseHex(value, color) ?? (parseColor(value) ? toHex(parseColor(value)!) : null);
                if (!hex) return "Use a hex colour such as 2B2B2B";
                commit(hex);
              }}
            />
            {/* A custom page colour resets from inside the field, on hover only (Wonder keeps the column for the eye). */}
            {background ? (
              <button
                type="button"
                aria-label="Reset page colour"
                title="Reset page colour"
                className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 group-hover/page:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => updatePage({ background: undefined })}
              >
                <RotateCcw className="size-3.5" aria-hidden />
              </button>
            ) : null}
            {/* Page backgrounds are opaque hex colours; the opacity is shown, not edited. The eye hides the page
                background: Wonder (H8-eye-hidden) then reads 0 %, dims the field and keeps the hex. */}
            <span
              className={cn("shrink-0 select-none tabular-nums", hidden && "text-muted-foreground")}
              title="Page colour opacity"
              data-page-opacity={hidden ? 0 : 100}
            >
              {hidden ? 0 : 100} <span className="text-muted-foreground">%</span>
            </span>
          </div>
        </ColorPopover>
        <IconButton
          icon={hidden ? ClosedEyeIcon : Eye}
          label={hidden ? "Show page background" : "Hide page background"}
          data-page-visibility={hidden ? "hidden" : "visible"}
          onClick={() => updatePage({ backgroundHidden: hidden ? undefined : true })}
        />
      </div>
    </Section>
  );
}

/* ---------- Optional sections ---------- */
function useOptional(nodeId: string | undefined, hasValue: boolean) {
  const [open, setOpen] = useState(hasValue);
  useEffect(() => {
    setOpen(hasValue);
    // Reset per layer: open when the layer already uses the property.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);
  useEffect(() => {
    if (hasValue) setOpen(true);
  }, [hasValue]);
  return [open, setOpen] as const;
}

/**
 * Wonder has no Layer section (properties-audit A8). Its actions live elsewhere: rename in the layer tree, parent
 * by dragging in the layer tree (or Frame / Unframe selection), and Scale ½× / 2×, Duplicate and Delete in the canvas
 * context menu and shortcuts. Those commands click these ids (`$('#duplicate')` …), so hidden proxies keep them
 * pointing at the detached legacy form's handlers.
 */
const LAYER_COMMANDS = [
  ["scale-down", "Scale ½×"],
  ["scale-up", "Scale 2×"],
  ["duplicate", "Duplicate layer"],
  ["delete", "Delete layer"],
] as const;
function LayerCommands() {
  return (
    <div hidden aria-hidden id="layer-commands">
      {LAYER_COMMANDS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          id={id}
          tabIndex={-1}
          aria-label={label}
          onClick={() => formClick(id)}
        />
      ))}
    </div>
  );
}

/* ---------- Panel body ---------- */
export function PropertiesBody({
  doc,
  node,
  selection,
}: {
  doc: DesignDocument;
  node: Node | undefined;
  selection: string[];
}) {
  // Slots keep fixed positions so the always-mounted Fill section (with #shader-settings / #fill-hex) never remounts.
  const many = !!node && selection.length > 1;
  const fillsMixed = many && mixedFills(doc, selection);
  const shadowsMixed = many && mixedShadows(doc, selection);
  const filtersMixed = many && mixedFilters(doc, selection);
  // Wonder D1: the armed Frame tool with nothing selected offers frame presets in place of the Page section.
  const tool = useCanvasTool();
  const framePresets = tool === "frame" && !node;
  // Wonder T4-scale-retry / R2: the armed Scale tool with one or more layers selected shows only the Scale section.
  // The other sections stay mounted but hidden (legacy render() writes into the Fill section's #shader-settings).
  const scaling = tool === "scale" && !!node;
  // Preview audit PF6: a live preview frame gets a viewport inspector (Screen template, Position, Layout,
  // Appearance, Export) without the ordinary frame sections.
  const preview = !many && isPreviewFrame(node);
  const plain = node && !preview ? node : undefined;
  return (
    <>
      {scaling ? (
        <ScaleSection key={"scale-" + selection.join(",")} node={node} selection={selection} />
      ) : null}
      <div className={scaling ? "hidden" : "contents"}>
        {node && preview ? <PreviewTemplateSection node={node} /> : null}
        {node && !many && !preview ? <ComponentSection doc={doc} node={node} /> : null}
        {node ? <PositionSection doc={doc} node={node} selection={selection} /> : null}
        {node && preview ? (
          <PreviewLayoutSection doc={doc} node={node} selection={selection} />
        ) : null}
        {node && preview ? (
          <PreviewAppearanceSection doc={doc} node={node} selection={selection} />
        ) : null}
        {plain ? <LayoutSection doc={doc} node={plain} selection={selection} /> : null}
        {plain ? <AppearanceSection doc={doc} node={plain} selection={selection} /> : null}
        {node?.type === "text" ? (
          <TypographySection
            key={"typography-" + node.id}
            doc={doc}
            node={node}
            selection={selection}
          />
        ) : null}
        {/* Mixed fills across a multi-selection: one "Click to replace" well (the Fill section stays mounted, hidden). */}
        {node && fillsMixed ? (
          <MixedSection
            id="fill-mixed-section"
            title={node.type === "text" ? "Text Fill" : "Background Fill"}
            label="Click to replace background fills"
            onReplace={() => replaceFills(node, selection)}
          />
        ) : null}
        <FillSection doc={doc} node={fillsMixed ? undefined : plain} selection={selection} />
        {node?.type === "text" && !fillsMixed ? (
          <TextBackgroundFillSection doc={doc} node={node} selection={selection} />
        ) : null}
        {/* A vector's stroke follows its path (cap, join, dash) instead of the box border. */}
        {plain?.type === "vector" ? (
          <VectorStrokeSection doc={doc} node={plain} selection={selection} />
        ) : plain ? (
          <BorderSection doc={doc} node={plain} selection={selection} />
        ) : null}
        {plain ? <OutlineSection doc={doc} node={plain} selection={selection} /> : null}
        {node && shadowsMixed ? (
          <MixedSection
            id="shadow-mixed-section"
            title="Shadow"
            label="Click to replace box shadows"
            onReplace={() => replaceList(node, selection, "shadows")}
          />
        ) : plain ? (
          <ShadowSection key={"shadow-" + plain.id} doc={doc} node={plain} selection={selection} />
        ) : null}
        {node && filtersMixed ? (
          <MixedSection
            id="filter-mixed-section"
            title="Filters"
            label="Click to replace filters"
            onReplace={() => replaceList(node, selection, "filters")}
            bodyClassName="pt-0.25 pb-2.5"
          >
            <SelectionFilters doc={doc} selection={selection} />
          </MixedSection>
        ) : plain ? (
          <>
            <FilterSection doc={doc} node={plain} selection={selection} />
            <SelectionFilters doc={doc} selection={selection} standalone />
          </>
        ) : null}
        {plain ? (
          <MaskSection key={"mask-" + plain.id} doc={doc} node={plain} selection={selection} />
        ) : null}
        {plain ? <SelectionColorsSection doc={doc} node={plain} selection={selection} /> : null}
        {node ? <ExportSection doc={doc} node={node} selection={selection} /> : null}
        {framePresets ? <FramePresetsSection /> : null}
        {!node && !framePresets ? <PageSection doc={doc} /> : null}
      </div>
      <LayerCommands />
    </>
  );
}
