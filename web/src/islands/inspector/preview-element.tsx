// Inspector for a DOM element selected in a live preview's Edit mode (Wonder PM3-inspector), laid out like the layer
// inspector: Position (alignment, X/Y, rotation, constraints, Z and the constraint diagram, all read-only), Layout
// (W/H, min width/height, padding, margin), Appearance (opacity, corner radius, Clip content), Typography and Text
// Fill. Values are the page's computed styles; editing one stages a transient style on the element through
// window.previewEdits (web/preview-edit.js).
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { ChevronDown, Droplet, Expand, Eye, Scan } from "lucide-react";
import {
  AngleIcon,
  FlipHorizontalIcon,
  FlipVerticalIcon,
  FontSizeIcon,
  LineHeightIcon,
  MarginSidesIcon,
  MarginXIcon,
  MarginYIcon,
  OpacityIcon,
  PaddingSidesIcon,
  PaddingXIcon,
  PaddingYIcon,
  RotateRightIcon,
  SizeMinIcon,
  SizeOptionsIcon,
  SlidersIcon,
} from "@/components/icons";
import { useDesign } from "@/lib/bridge";
import {
  Affix,
  Caption,
  Field,
  IconAffix,
  IconButton,
  NativeSelect,
  Section,
  Swatch,
  type IconType,
} from "./controls";
import { ConstraintSelect, ConstraintWidget } from "./constraints";
import { Row, SizeMinHIcon } from "./layout";
import { ALIGN_GROUPS, InspectorCheckbox, ToolButton, ToolGroup } from "./properties";
import { FontFamilyPicker } from "./typography";
import { isUnsupportedFont, loadCatalog, loadLocalFonts, type FontEntry } from "./fonts";
import { WEIGHTS, weightName, type Node } from "./model";

type Styles = Record<string, string>;
export type PreviewElement = {
  path: string;
  tag: string;
  text: string;
  leaf: boolean;
  box: { x: number; y: number; width: number; height: number };
  position: { x: number; y: number };
  sizing?: { w: string; h: string };
  styles: Styles;
};
type Selection = { frameId: string; element: PreviewElement; editing: boolean } | null;
type EditsApi = { selection(): Selection; setStyle(prop: string, value: string): void };
const edits = () => (window as unknown as { previewEdits?: EditsApi }).previewEdits;

let cached: Selection = null;
let cachedKey = "";
function snapshot(): Selection {
  const next = edits()?.selection() ?? null;
  const key = next ? JSON.stringify(next) : "";
  if (key !== cachedKey) {
    cachedKey = key;
    cached = next;
  }
  return cached;
}
function subscribe(callback: () => void) {
  window.addEventListener("bd:preview-element", callback);
  return () => window.removeEventListener("bd:preview-element", callback);
}
/** The DOM element selected in a preview's Edit mode, or null. */
export function usePreviewElement() {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

type LivePreviewApi = { getSelectionState?(): { mode?: string } | null };
const inEditMode = () =>
  (window as unknown as { livePreview?: LivePreviewApi }).livePreview?.getSelectionState?.()
    ?.mode === "edit";
function subscribeMode(callback: () => void) {
  window.addEventListener("bd:preview-state", callback);
  return () => window.removeEventListener("bd:preview-state", callback);
}
/** The selected preview frame is in Edit mode. Until an element is picked, Wonder leaves Properties empty (PM3-hover). */
export function usePreviewEditMode() {
  return useSyncExternalStore(subscribeMode, inEditMode, () => false);
}

const r2 = (v: number) => String(Math.round(v * 100) / 100);
const px = (value: string | undefined) => {
  const n = parseFloat(value ?? "");
  return Number.isFinite(n) ? r2(n) : "";
};
const firstFamily = (value: string) =>
  (value.split(",")[0] || "").trim().replace(/^["']|["']$/g, "");
function hex(color: string) {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?/.exec(color);
  if (!m) return { hex: "", alpha: 100 };
  const part = (v: string) => Math.round(Number(v)).toString(16).padStart(2, "0");
  const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : Number(m[4]);
  return {
    hex: (part(m[1]) + part(m[2]) + part(m[3])).toUpperCase(),
    alpha: Math.round(alpha * 100),
  };
}
const length = (raw: string) => {
  const t = raw.trim();
  if (!t) return "";
  return /^-?\d*\.?\d+$/.test(t) ? t + "px" : t;
};

/** A header or row tool Wonder draws for a DOM element, inert here (its behaviour on page elements is not proven). */
function InertTool({ icon, label }: { icon: IconType; label: string }) {
  return <IconButton icon={icon} label={label} disabled className="disabled:opacity-100" />;
}
/** "px ▾" at the end of a field, like the unit menus of the layer inspector. */
const unitChevron = (unit?: string) => (
  <>
    {unit ? <span>{unit}</span> : null}
    <ChevronDown aria-hidden className="size-3 shrink-0" />
  </>
);
const READ_ONLY = "bg-field-disabled";
const noop = () => null;

/** Fonts for the family picker: the catalog, plus installed fonts once the picker opens. */
function useFonts() {
  const [catalog, setCatalog] = useState<FontEntry[]>([]);
  const [installed, setInstalled] = useState<FontEntry[]>([]);
  useEffect(() => {
    let live = true;
    void loadCatalog().then((fonts) => live && setCatalog(fonts));
    return () => {
      live = false;
    };
  }, []);
  const fonts = useMemo(() => [...catalog, ...installed], [catalog, installed]);
  return { fonts, requestLocal: () => void loadLocalFonts().then(setInstalled) };
}

function Group({ label, tool, children }: { label: string; tool: ReactNode; children: ReactNode }) {
  return (
    <Caption label={label} className="mt-2">
      <Row tool={tool}>{children}</Row>
    </Caption>
  );
}

export function PreviewElementBody({ element }: { element: PreviewElement }) {
  const doc = useDesign();
  const { fonts, requestLocal } = useFonts();
  const set =
    (prop: string, transform: (raw: string) => string = length) =>
    (raw: string) =>
      edits()?.setStyle(prop, transform(raw));
  const st = element.styles;
  const fill = hex(st.color || "");
  const lineHeight = st.lineHeight === "normal" ? "Auto" : px(st.lineHeight);
  const letterSpacing = st.letterSpacing === "normal" ? "0" : px(st.letterSpacing);
  const minimum = (value: string | undefined) => px(value) || "0";
  const clipped = /^(hidden|clip)/.test(st.overflow || "");
  const weight = String(st.fontWeight || "400");
  const weights = WEIGHTS.some(([v]) => v === weight)
    ? WEIGHTS
    : [...WEIGHTS, [weight, weightName(weight)] as [string, string]];
  const family = firstFamily(st.fontFamily || "");
  // Wonder PM3: with an unsupported family the weight menu is dimmed (no weights to offer).
  const unsupported = isUnsupportedFont(family, fonts, { generic: false });
  // The picker reads the family from a layer-shaped value; choosing stages font-family on the page element.
  const familyNode = useMemo(() => ({ id: "", fontFamily: family }) as unknown as Node, [family]);
  return (
    <div id="preview-element-inspector" data-element-path={element.path}>
      <Section title="Position" tools={<InertTool icon={Expand} label="Resize to fill" />}>
        <div className="grid grid-cols-3 gap-2">
          {ALIGN_GROUPS.map((group) => (
            <ToolGroup key={group[0]?.id} disabled>
              {group.map((b) => (
                <ToolButton key={b.id} label={b.label} icon={b.icon} disabled onClick={noop} />
              ))}
            </ToolGroup>
          ))}
          <ToolGroup disabled>
            <ToolButton label="Rotate 90°" icon={RotateRightIcon} disabled onClick={noop} />
            <ToolButton label="Flip horizontal" icon={FlipHorizontalIcon} disabled onClick={noop} />
            <ToolButton label="Flip vertical" icon={FlipVerticalIcon} disabled onClick={noop} />
          </ToolGroup>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field
            name="pe-x"
            label="X"
            value={r2(element.position.x)}
            onCommit={noop}
            prefix={<Affix>X</Affix>}
            className={READ_ONLY}
            disabled
          />
          <Field
            name="pe-y"
            label="Y"
            value={r2(element.position.y)}
            onCommit={noop}
            prefix={<Affix>Y</Affix>}
            className={READ_ONLY}
            disabled
          />
          <Field
            name="pe-rotation"
            label="Rotation"
            value="0"
            onCommit={noop}
            prefix={<IconAffix icon={AngleIcon} />}
            suffix="°"
            inputClassName="disabled:text-foreground"
            disabled
          />
        </div>
        <div className="grid grid-cols-3 gap-2" data-preview-constraints>
          <ConstraintSelect axis="h" selection={[]} list={null} />
          <ConstraintSelect axis="v" selection={[]} list={null} />
          <ConstraintWidget selection={[]} list={null} />
          <Field
            name="pe-z"
            label="Stack order"
            value=""
            placeholder="Auto"
            onCommit={noop}
            prefix={<Affix>Z</Affix>}
            className={"col-span-2 " + READ_ONLY}
            inputClassName="disabled:placeholder:text-field-disabled-foreground"
            disabled
          />
        </div>
      </Section>
      <Section title="Layout">
        <Row tool={<InertTool icon={SizeOptionsIcon} label="Size options" />}>
          <Field
            name="pe-width"
            label="Width"
            numeric
            value={r2(element.box.width)}
            onCommit={set("width")}
            prefix={<Affix>W</Affix>}
            className="pr-1"
            suffix={unitChevron("px")}
          />
          <Field
            name="pe-height"
            label="Height"
            numeric
            value={r2(element.box.height)}
            onCommit={set("height")}
            prefix={<Affix>H</Affix>}
            className="pr-1"
            suffix={unitChevron("px")}
          />
        </Row>
        <Row>
          <Field
            name="pe-min-width"
            label="Min width"
            numeric
            value={minimum(st.minWidth)}
            onCommit={set("min-width")}
            prefix={<IconAffix icon={SizeMinIcon} />}
            className="col-span-2 pr-1"
            suffix={unitChevron()}
          />
        </Row>
        <Row>
          <Field
            name="pe-min-height"
            label="Min height"
            numeric
            value={minimum(st.minHeight)}
            onCommit={set("min-height")}
            prefix={<IconAffix icon={SizeMinHIcon} />}
            className="col-span-2 pr-1"
            suffix={unitChevron()}
          />
        </Row>
        <Group
          label="Padding"
          tool={<InertTool icon={PaddingSidesIcon} label="Independent padding" />}
        >
          <Field
            name="pe-padding-x"
            label="Horizontal padding"
            numeric
            value={px(st.paddingLeft)}
            onCommit={set("padding-inline")}
            prefix={<IconAffix icon={PaddingXIcon} />}
            suffix="px"
          />
          <Field
            name="pe-padding-y"
            label="Vertical padding"
            numeric
            value={px(st.paddingTop)}
            onCommit={set("padding-block")}
            prefix={<IconAffix icon={PaddingYIcon} />}
            suffix="px"
          />
        </Group>
        <Group
          label="Margin"
          tool={<InertTool icon={MarginSidesIcon} label="Independent margins" />}
        >
          <Field
            name="pe-margin-x"
            label="Horizontal margin"
            numeric
            value={px(st.marginLeft)}
            onCommit={set("margin-inline")}
            prefix={<IconAffix icon={MarginXIcon} />}
            className="pr-1"
            suffix={unitChevron("px")}
          />
          <Field
            name="pe-margin-y"
            label="Vertical margin"
            numeric
            value={px(st.marginTop)}
            onCommit={set("margin-block")}
            prefix={<IconAffix icon={MarginYIcon} />}
            className="pr-1"
            suffix={unitChevron("px")}
          />
        </Group>
      </Section>
      <Section
        title="Appearance"
        tools={
          <>
            <InertTool icon={Eye} label="Hide element" />
            <InertTool icon={Droplet} label="Blend mode" />
          </>
        }
      >
        <div className="flex items-end gap-2">
          <Caption label="Opacity" className="flex-1">
            <Field
              name="pe-opacity"
              label="Opacity"
              numeric
              value={r2(Number(st.opacity || 1) * 100)}
              onCommit={set("opacity", (raw) =>
                raw.trim() ? String(Math.max(0, Math.min(100, Number(raw))) / 100) : "",
              )}
              prefix={<IconAffix icon={OpacityIcon} />}
              suffix="%"
            />
          </Caption>
          <Caption label="Corner radius" className="flex-1">
            <Field
              name="pe-radius"
              label="Corner radius"
              numeric
              value={px(st.borderRadius)}
              onCommit={set("border-radius")}
              prefix={<IconAffix icon={Scan} />}
            />
          </Caption>
          <InertTool icon={Scan} label="Independent corner radii" />
        </div>
        <InspectorCheckbox
          name="pe-clip"
          label="Clip content"
          checked={clipped}
          onChange={(on) => edits()?.setStyle("overflow", on ? "hidden" : "visible")}
        />
      </Section>
      <Section title="Typography" tools={<InertTool icon={SlidersIcon} label="Type settings" />}>
        <div data-preview-font-family>
          <FontFamilyPicker
            doc={doc}
            node={familyNode}
            selection={[]}
            fonts={fonts}
            onLocalFonts={requestLocal}
            onChoose={(next) => edits()?.setStyle("font-family", next)}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NativeSelect
            name="pe-font-weight"
            label="Font weight"
            value={weight}
            options={weights.map(([value, label]) => ({ value, label }))}
            onChange={set("font-weight", (raw) => raw)}
            disabled={unsupported}
          />
          <Field
            name="pe-font-size"
            label="Font size"
            numeric
            value={px(st.fontSize)}
            onCommit={set("font-size")}
            prefix={<IconAffix icon={FontSizeIcon} />}
            suffix="px"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Caption label="Line height">
            <Field
              name="pe-line-height"
              label="Line height"
              numeric
              value={lineHeight}
              placeholder="Auto"
              onCommit={set("line-height", (raw) =>
                /^auto$/i.test(raw.trim()) ? "normal" : length(raw),
              )}
              prefix={<IconAffix icon={LineHeightIcon} />}
            />
          </Caption>
          <Caption label="Letter spacing">
            <Field
              name="pe-letter-spacing"
              label="Letter spacing"
              numeric
              step={0.1}
              value={letterSpacing}
              onCommit={set("letter-spacing")}
              prefix={<Affix className="-mx-px w-3.5 text-2xs">|A|</Affix>}
              suffix="px"
            />
          </Caption>
        </div>
      </Section>
      <Section title="Text Fill">
        <Field
          name="pe-color"
          label="Text color"
          value={fill.hex}
          onCommit={set("color", (raw) => {
            const v = raw.trim().replace(/^#/, "");
            return /^[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$/i.test(v) ? "#" + v : raw.trim();
          })}
          prefix={<Swatch color={st.color || ""} />}
          suffix={`${fill.alpha} %`}
        />
      </Section>
    </div>
  );
}
