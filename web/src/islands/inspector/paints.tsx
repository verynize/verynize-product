import { alreadyReported, prepareImage } from "@/lib/image-upload";
// Paint stack for Background Fill and Text Fill (design/wonder/2026-10-30 05–07, 23–26): several paints per
// layer (top paint first), each Solid, Linear, Radial or Conic gradient, or Image, with per-paint opacity and
// visibility. Solid colours and gradient stops bind to colour variables; detaching keeps the resolved colour.
// A stack of one visible solid paint is stored as the layer's plain `color`/`token` (older documents keep
// that shape); anything else is stored in `fills` (see web/node-style.js for rendering and validation).
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Eye,
  GripVertical,
  ImageIcon,
  Plus,
  RotateCw,
  Square,
  Unlink,
  X,
} from "lucide-react";
import { ClosedEyeIcon, GradientPaintIcon, RemoveIcon } from "@/components/icons";
import type { DesignDocument } from "@/lib/bridge";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { ColorPicker, ColorPopover } from "./color-picker";
import { alphaPercent, parseColor, toHex, withAlpha } from "./color";
import { Field, IconButton, NativeSelect, Swatch, type IconType } from "./controls";
import { VariableChip } from "./bind";
import { notify } from "./legacy";
import { HEX, hexLabel, pageNodes, parseHex, patchNodes, type Node } from "./model";
import { setTokenColor } from "./vars";
import { isParam } from "./shader-library";
import { ShaderModeToggle, shaderModeApplies } from "./shader-mode";

export type Stop = { position: number; color: string; token?: string };
export type Paint = {
  type: "solid" | "linear" | "radial" | "conic" | "image";
  color?: string;
  token?: string;
  opacity?: number;
  hidden?: boolean;
  angle?: number;
  stops?: Stop[];
  src?: string;
  fit?: "fill" | "cover" | "contain" | "none";
  imageWidth?: number;
  imageHeight?: number;
};
type Tokens = Record<string, string>;
type PaintNode = Node & { fills?: Paint[]; backgroundFills?: Paint[] };
/**
 * Which stack a PaintStack edits: the layer's own `fills` (Background Fill, or Text Fill on text), or a text layer's
 * `backgroundFills` (Wonder A10: Background Fill behind the glyphs). The background stack never collapses into
 * `color`/`token`, and an empty one is removed from the node.
 */
export type PaintTarget = "fills" | "backgroundFills";
const PaintTargetContext = createContext<PaintTarget>("fills");

const TYPES: { value: Paint["type"]; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "linear", label: "Linear" },
  { value: "radial", label: "Radial" },
  { value: "conic", label: "Conic" },
  { value: "image", label: "Image" },
];
const FITS: { value: NonNullable<Paint["fit"]>; label: string }[] = [
  { value: "fill", label: "Fill" },
  { value: "cover", label: "Cover" },
  { value: "contain", label: "Contain" },
  { value: "none", label: "None" },
];
const isGradient = (p: Paint) => p.type === "linear" || p.type === "radial" || p.type === "conic";
const typeLabel = (p: Paint) => TYPES.find((t) => t.value === p.type)?.label ?? p.type;

type Css = {
  paintColor(hex: string, opacity?: number): string;
  fillsCss(n: { fills: Paint[] }, tokens: Tokens): { layers: { image: string }[] } | null;
};
const css = () => (window as unknown as { BetterNodeStyle: Css }).BetterNodeStyle;

/** The paints a layer shows, top first. Older layers have one solid paint from `color`/`token`. */
export function paintsOf(node: Node, target: PaintTarget = "fills"): Paint[] {
  if (target === "backgroundFills") {
    const background = (node as PaintNode).backgroundFills;
    return Array.isArray(background) ? structuredClone(background) : [];
  }
  const fills = (node as PaintNode).fills;
  if (Array.isArray(fills)) return structuredClone(fills);
  if (!HEX.test(node.color)) return [];
  return [{ type: "solid", color: node.color, ...(node.token ? { token: node.token } : {}) }];
}
const resolved = (c: { color?: string; token?: string }, tokens: Tokens) =>
  (c.token && tokens[c.token]) || c.color || "#000000";

/** Node patch for a stack: one plain visible solid paint collapses back into `color`/`token`. */
function stackPatch(
  node: Node,
  paints: Paint[],
  tokens: Tokens,
  target: PaintTarget = "fills",
): Record<string, unknown> {
  if (target === "backgroundFills") return { backgroundFills: paints.length ? paints : undefined };
  const [only] = paints;
  // Removing the last paint leaves no fill at all: no stale `color` for readers that ignore `fills`.
  if (!paints.length) return { fills: undefined, color: "transparent", token: "" };
  if (
    paints.length === 1 &&
    only.type === "solid" &&
    !only.hidden &&
    (only.opacity ?? 100) === 100 &&
    HEX.test(only.color ?? "")
  )
    return { fills: undefined, color: only.color, token: only.token ?? "" };
  // Readers that ignore `fills` (codec class names, shader colour) see the top visible colour.
  const top = paints.find((p) => !p.hidden && (p.type === "solid" || isGradient(p)));
  const color = top
    ? top.type === "solid"
      ? resolved(top, tokens)
      : resolved(top.stops![0], tokens)
    : node.color;
  return { fills: paints, color: HEX.test(color) ? color : node.color, token: "" };
}

/** Apply a stack edit to every selected layer (each from its own paints): one validated undo step. */
export function editPaints(
  selection: string[],
  edit: (paints: Paint[], node: Node) => Paint[] | null,
  target: PaintTarget = "fills",
  /** Further fields for every edited layer (same undo step), e.g. leaving Shader mode. */
  extra?: Record<string, unknown>,
) {
  const tokens = window.design.getDocument().tokens ?? {};
  patchNodes(selection, (node) => {
    if (node.type === "shader") return {};
    // Only text layers carry a Background Fill stack behind the glyphs.
    if (target === "backgroundFills" && node.type !== "text") return {};
    const next = edit(paintsOf(node, target), node);
    return next ? { ...stackPatch(node, next, tokens, target), ...extra } : {};
  });
}
/** `editPaints` bound to the stack this component renders (the module-level name stays the call shape). */
function usePaintEditor() {
  const target = useContext(PaintTargetContext);
  return (selection: string[], edit: (paints: Paint[], node: Node) => Paint[] | null) =>
    editPaints(selection, edit, target);
}
const at = (i: number, fn: (p: Paint) => Paint | null) => (paints: Paint[]) =>
  paints[i] ? (paints.map((p, j) => (j === i ? fn(p) : p)).filter(Boolean) as Paint[]) : null;

/** Detach every colour variable of a paint, keeping the resolved colour. */
function detachPaint(p: Paint, tokens: Tokens): Paint {
  const free = <T extends { color?: string; token?: string }>(c: T): T => {
    const rest = { ...c };
    delete rest.token;
    return { ...rest, color: resolved(c, tokens) } as T;
  };
  return p.type === "solid" ? free(p) : p.stops ? { ...p, stops: p.stops.map(free) } : p;
}
export const paintBound = (p: Paint) => !!p.token || !!p.stops?.some((s) => !!s.token);

/** Convert a paint to another type, keeping its colours. */
function convert(p: Paint, type: Paint["type"], tokens: Tokens): Paint {
  const base = {
    ...(p.hidden ? { hidden: true } : {}),
    ...(p.opacity !== undefined ? { opacity: p.opacity } : {}),
  };
  if (type === "solid") {
    const c = p.type === "solid" ? p : p.stops?.[0];
    return { ...base, type, color: c?.color ?? "#d9d9d9", ...(c?.token ? { token: c.token } : {}) };
  }
  if (type === "image") return { ...base, type, src: p.src, fit: p.fit ?? "fill" };
  const stops: Stop[] = p.stops
    ? p.stops
    : [
        {
          position: 0,
          color: p.type === "solid" ? (p.color ?? "#d9d9d9") : "#d9d9d9",
          ...(p.token ? { token: p.token } : {}),
        },
        { position: 100, color: invertish(resolved(p, tokens)) },
      ];
  return {
    ...base,
    type,
    stops,
    ...(type !== "radial" ? { angle: p.angle ?? (type === "linear" ? 180 : 0) } : {}),
  };
}
/** A second stop that contrasts with the first. */
function invertish(hex: string) {
  const c = parseColor(hex);
  if (!c) return "#ffffff";
  const light = (c.r * 299 + c.g * 587 + c.b * 114) / 1000 > 128;
  return light ? "#172033" : "#f8fafc";
}

/** Live canvas preview while dragging in the colour picker (committed on release through updateNodes). */
function previewSolid(nodes: Node[], color: string) {
  for (const n of nodes) {
    const el = document.querySelector<HTMLElement>(`#canvas [data-id="${CSS.escape(n.id)}"]`);
    if (!el) continue;
    if (n.type === "text") el.style.color = color;
    else el.style.backgroundColor = color;
  }
}

/** Read an image file as an embedded data URL plus its natural size. */
async function readImage(file: File) {
  const { src, pixelWidth, pixelHeight } = await prepareImage(file);
  return { src, imageWidth: pixelWidth, imageHeight: pixelHeight };
}
function pickImage(onPick: (image: Awaited<ReturnType<typeof readImage>>) => void) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = window.imageUpload.ACCEPT;
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      onPick(await readImage(file));
    } catch (error) {
      if (!alreadyReported(error)) notify(error instanceof Error ? error.message : String(error));
    }
  };
  input.click();
}

/** Swatch preview of a paint (gradients and images included). */
function paintPreview(p: Paint, tokens: Tokens) {
  if (p.type === "solid") return css().paintColor(resolved(p, tokens), 100);
  const layer = css().fillsCss({ fills: [{ ...p, hidden: false, opacity: 100 }] }, tokens)
    ?.layers[0];
  return p.type === "image"
    ? `${layer?.image ?? "none"} center / cover no-repeat`
    : (layer?.image ?? "transparent");
}

/* ---------- Header tools: Shader mode + Add paint ---------- */
/** Wonder A1: the first paint is white; every further paint is black at 20 %. */
const defaultPaint = (paints: Paint[]): Paint =>
  paints.length ? { type: "solid", color: "#00000033" } : { type: "solid", color: "#ffffff" };

/**
 * Header of a Fill section (Wonder A1): the wavy-square Shader mode toggle (H6), then `+`, 8 px apart. Binding a
 * colour variable happens in the picker's Variables tab and detaching in the row itself.
 */
export function FillTools({
  node,
  selection,
  target = "fills",
}: {
  doc: DesignDocument;
  node: Node;
  selection: string[];
  target?: PaintTarget;
}) {
  const background = target === "backgroundFills";
  // Shader layers keep one colour (it drives the shader) and have no header tools.
  if (node.type === "shader") return null;
  const shader = shaderModeApplies(node, target) && !!node.shaderFill;
  return (
    <div className="flex items-center gap-2" data-paint-target={target}>
      <ShaderModeToggle node={node} selection={selection} target={target} />
      {/* Wonder keeps `+` in Shader mode (H6-open-confirmed); adding a paint goes back to the paint rows. */}
      <IconButton
        icon={Plus}
        label={background ? "Add background paint" : "Add paint"}
        onClick={() =>
          editPaints(
            selection,
            (ps) => [defaultPaint(ps), ...ps],
            target,
            shader ? { shaderFill: undefined } : undefined,
          )
        }
      />
    </div>
  );
}

/** Whether the stack renders any row (an empty Fill section is its header only). */
export const hasPaintRows = (node: Node, target: PaintTarget = "fills") =>
  (target === "fills" && node.type === "shader") ||
  (shaderModeApplies(node, target) && !!node.shaderFill) ||
  paintsOf(node, target).length > 0;

/* ---------- Stack ---------- */
export function PaintStack({
  doc,
  node,
  selection,
  target = "fills",
}: {
  doc: DesignDocument;
  node: Node;
  selection: string[];
  target?: PaintTarget;
}) {
  const paints = paintsOf(node, target);
  // Shader layers keep one colour (it drives the shader); the stack applies to boxes and text.
  if (node.type === "shader" && target === "fills")
    return (
      <SolidRow doc={doc} node={node} selection={selection} paints={paints} index={0} legacy />
    );
  // Shader mode (H6): a parametric preset's colours replace the paint rows (ShaderFill); classic presets are
  // tinted by the fill colour, so its rows stay. The stored paints are kept either way.
  if (shaderModeApplies(node, target) && node.shaderFill && isParam(node.shaderPreset)) return null;
  // Wonder A1: no placeholder text; the section collapses to its header.
  if (!paints.length) return null;
  return (
    <PaintTargetContext.Provider value={target}>
      <div
        className="flex flex-col gap-2.25"
        data-paint-stack={paints.length}
        data-paint-target={target}
      >
        {paints.map((p, i) =>
          p.type === "solid" ? (
            <SolidRow
              key={i}
              doc={doc}
              node={node}
              selection={selection}
              paints={paints}
              index={i}
            />
          ) : (
            <PaintRow
              key={i}
              doc={doc}
              node={node}
              selection={selection}
              paints={paints}
              index={i}
            />
          ),
        )}
      </div>
    </PaintTargetContext.Provider>
  );
}

type RowProps = {
  doc: DesignDocument;
  node: Node;
  selection: string[];
  paints: Paint[];
  index: number;
  legacy?: boolean;
};

/** Visibility and remove buttons shared by every row (eye centre x 224, `−` x 256). */
function RowTools({ selection, paints, index }: Omit<RowProps, "doc" | "node">) {
  const editPaints = usePaintEditor();
  const p = paints[index];
  return (
    <>
      <IconButton
        icon={p.hidden ? ClosedEyeIcon : Eye}
        label={p.hidden ? "Show paint" : "Hide paint"}
        data-paint-visibility={index}
        onClick={() =>
          editPaints(
            selection,
            at(index, (q) => ({ ...q, hidden: !q.hidden || undefined })),
          )
        }
      />
      <IconButton
        icon={RemoveIcon}
        label="Remove paint"
        data-paint-remove={index}
        onClick={() =>
          editPaints(
            selection,
            at(index, () => null),
          )
        }
      />
    </>
  );
}

/** Move the paint at `from` to position `to` (top first). */
const moveTo = (from: number, to: number) => (paints: Paint[]) => {
  if (from === to || !paints[from] || to < 0 || to >= paints.length) return null;
  const next = [...paints];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};
/** Keyboard reorder in the paint editor's title row (the hover grip is pointer-only). */
function MoveTools({ selection, paints, index }: Omit<RowProps, "doc" | "node">) {
  const editPaints = usePaintEditor();
  if (paints.length < 2) return null;
  return (
    <>
      <IconButton
        icon={ArrowUp}
        label="Move paint up"
        disabled={index === 0}
        onClick={() => editPaints(selection, moveTo(index, index - 1))}
      />
      <IconButton
        icon={ArrowDown}
        label="Move paint down"
        disabled={index === paints.length - 1}
        onClick={() => editPaints(selection, moveTo(index, index + 1))}
      />
    </>
  );
}

/**
 * Wonder A1-background-hover: a 6-dot grip in the left gutter (x 3–9) of the hovered row. Dragging it over the
 * other rows of the stack reorders the paint, committed once on release.
 */
function DragGrip({ selection, paints, index }: Omit<RowProps, "doc" | "node">) {
  const editPaints = usePaintEditor();
  if (paints.length < 2) return null;
  const start = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const grip = event.currentTarget;
    const row = grip.closest<HTMLElement>("[data-paint]");
    const stack = row?.parentElement;
    if (!row || !stack) return;
    const rows = [...stack.querySelectorAll<HTMLElement>(":scope > [data-paint]")];
    grip.setPointerCapture(event.pointerId);
    row.dataset.dragging = "";
    let target = index;
    const move = (e: PointerEvent) => {
      const i = rows.findIndex((r) => e.clientY < r.getBoundingClientRect().bottom);
      target = i < 0 ? rows.length - 1 : i;
      rows.forEach((r, j) => {
        if (j === target && j !== index) r.dataset.drop = "";
        else delete r.dataset.drop;
      });
    };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      rows.forEach((r) => {
        delete r.dataset.drop;
        delete r.dataset.dragging;
      });
      if (target !== index) editPaints(selection, moveTo(index, target));
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  };
  return (
    <span
      aria-hidden
      data-paint-grip={index}
      title="Drag to reorder"
      className="absolute -left-3 flex h-6 w-3 cursor-grab touch-none items-center justify-center text-muted-foreground opacity-0 group-hover/row:opacity-100 active:cursor-grabbing"
      onPointerDown={start}
    >
      <GripVertical className="size-3" aria-hidden />
    </span>
  );
}

/** One paint row: grip gutter, the 192 px field (x 12–204), eye and `−` 8 px apart; the open row gets Wonder's band. */
function Row({
  index,
  type,
  open,
  children,
  tools,
}: {
  index: number;
  type: Paint["type"];
  open: boolean;
  children: ReactNode;
  tools: ReactNode;
}) {
  return (
    <div
      className="group/row relative isolate flex items-center gap-2 rounded-md data-dragging:opacity-50 data-drop:ring-1 data-drop:ring-ring"
      data-paint={index}
      data-paint-type={type}
      data-open={open || undefined}
    >
      {/* Wonder: while its picker is open the whole 32 px band behind the row (x 0–280) is #2B2B2B, no ring. */}
      {open ? <span aria-hidden className="absolute -inset-x-3 -inset-y-1 -z-10 bg-input" /> : null}
      {children}
      {tools}
    </div>
  );
}

const rowBox =
  "group/paint flex h-6 min-w-0 flex-1 items-center gap-1 rounded-md bg-input pr-2 pl-1 text-xs shadow-field focus-within:ring-1 focus-within:ring-ring";
// Wonder A1: the number ends 4 px before the "%" (x 181 / 185.5), the % ends at 194.
const percentField =
  "h-5 w-12 shrink-0 gap-0.5 bg-transparent px-0 shadow-none focus-within:ring-0";

/**
 * The colour an unbound solid actually paints. Older documents (and agents) may carry a paint `opacity` on top of
 * the colour alpha; the row shows and edits the product, and every edit folds it back into the colour.
 */
function solidColor(p: Paint, tokens: Tokens) {
  const color = resolved(p, tokens);
  const opacity = p.opacity ?? 100;
  if (p.token || opacity === 100) return color;
  return withAlpha(color, (alphaPercent(color) * opacity) / 100) ?? color;
}

/** Detach the colour variable of one paint on every selected layer, keeping the resolved colour. */
function detachAt(selection: string[], index: number, target: PaintTarget = "fills") {
  const colors = window.design.getDocument().tokens ?? {};
  patchNodes(selection, (n) => {
    if (target === "fills" && (!(n as PaintNode).fills || n.type === "shader"))
      return n.token ? { color: colors[n.token] ?? n.color, token: "" } : {};
    const paints = paintsOf(n, target);
    if (!paints[index]) return {};
    return stackPatch(
      n,
      paints.map((p, i) => (i === index ? detachPaint(p, colors) : p)),
      colors,
      target,
    );
  });
}

/** Wonder B3: a bound colour is edited in its variable (alpha included); the binding stays. */
function editVariable(name: string, color: string) {
  setTokenColor(name, color);
}

/** A solid paint: hex (or bound variable), opacity, picker with Custom/Variables. */
function SolidRow({ doc, node, selection, paints, index, legacy }: RowProps) {
  const [open, setOpen] = useState(false);
  const target = useContext(PaintTargetContext);
  const editPaints = usePaintEditor();
  const background = target === "backgroundFills";
  const p = paints[index] ?? { type: "solid", color: node.color, token: node.token };
  const tokens = doc.tokens ?? {};
  const stacked = !!(node as PaintNode)[target];
  const color = solidColor(p, tokens);
  const first = index === 0;
  const selected = pageNodes(doc).filter((n) => selection.includes(n.id));
  const setPaint = (fn: (q: Paint) => Paint) =>
    legacy
      ? patchNodes(selection, () => {
          const next = fn(p);
          return { color: next.color, token: next.token ?? "" };
        })
      : editPaints(selection, at(index, fn));
  // An unbound edit writes the colour (alpha included) and drops any separate paint opacity.
  const commitFree = (next: string) =>
    setPaint((q) => {
      const rest = { ...q };
      delete rest.token;
      delete rest.opacity;
      return { ...rest, color: next };
    });
  const commit = (next: string) => (p.token ? editVariable(p.token, next) : commitFree(next));
  const bind = (name: string) =>
    setPaint((q) => ({ ...q, color: tokens[name] ?? q.color, token: name }));
  const opacity = alphaPercent(color);
  // The background stack gets its own names so both stacks of a text layer stay addressable.
  const label = background
    ? first
      ? "Background fill"
      : `Background paint ${index + 1}`
    : first
      ? "Fill"
      : `Paint ${index + 1}`;
  return (
    <Row
      index={index}
      type="solid"
      open={open}
      tools={legacy ? null : <RowTools selection={selection} paints={paints} index={index} />}
    >
      {legacy ? null : <DragGrip selection={selection} paints={paints} index={index} />}
      <ColorPopover
        open={open}
        onOpenChange={setOpen}
        value={color}
        onPreview={
          p.token || stacked || paints.length > 1
            ? undefined
            : (next) => previewSolid(selected, next)
        }
        onCommit={commit}
        tokens={tokens}
        token={p.token}
        onToken={bind}
        onDetach={p.token ? () => detachAt(selection, index, target) : undefined}
        typeSwitch={
          legacy ? undefined : (
            <PaintTypeSwitch
              doc={doc}
              node={node}
              selection={selection}
              paints={paints}
              index={index}
            />
          )
        }
        headTools={
          legacy ? undefined : <MoveTools selection={selection} paints={paints} index={index} />
        }
      >
        <div data-color-anchor className={rowBox}>
          <button
            type="button"
            name={first && !background ? "color" : undefined}
            aria-label={`${label} colour`}
            aria-expanded={open}
            title="Pick colour"
            className="flex size-4.5 shrink-0 items-center justify-center rounded-sm focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => setOpen(!open)}
          >
            <Swatch color={color} />
          </button>
          {p.token ? (
            <>
              <button
                type="button"
                data-paint-token={p.token}
                aria-label={`${label} variable ${p.token}`}
                title={
                  tokens[p.token]
                    ? `${p.token} = ${tokens[p.token]}`
                    : `${p.token} (missing variable)`
                }
                className="-ml-px flex h-5 min-w-0 flex-1 items-center rounded-sm text-left focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => setOpen(!open)}
              >
                <VariableChip name={p.token} missing={!tokens[p.token]} />
              </button>
              {/* Wonder A1/B3: the unlink shows inside the field on interaction only. */}
              <button
                type="button"
                aria-label="Detach variable"
                title="Detach variable"
                data-paint-unlink={index}
                className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => detachAt(selection, index, target)}
              >
                <Unlink className="size-3.5" aria-hidden />
              </button>
            </>
          ) : (
            <Field
              label={`${label} hex colour`}
              value={hexLabel(p.color ?? "")}
              placeholder={HEX.test(p.color ?? "") ? "" : p.color}
              className="-ml-px h-5 flex-1 bg-transparent px-0 shadow-none focus-within:ring-0"
              inputClassName="uppercase"
              onCommit={(value) => {
                const hex =
                  parseHex(value, color) ?? (parseColor(value) ? toHex(parseColor(value)!) : null);
                if (!hex) return "Use a hex colour such as A58BDD";
                commitFree(hex);
              }}
            />
          )}
          {/* Wonder B3: no percentage for any bound colour; its translucency lives in the variable. */}
          {p.token ? null : (
            <Field
              label={`${label} opacity`}
              numeric
              value={String(opacity)}
              className={percentField}
              inputClassName="text-right"
              suffix="%"
              onCommit={(value) => {
                const n = Number(value);
                if (!Number.isFinite(n)) return "Enter a percentage";
                const next = withAlpha(color, Math.max(0, Math.min(100, n)));
                if (!next) return "Enter a percentage";
                commitFree(next);
              }}
            />
          )}
        </div>
      </ColorPopover>
    </Row>
  );
}

/** Gradient or image paint row: preview swatch + type label opening the paint editor (Wonder: no %), tools. */
function PaintRow({ doc, node, selection, paints, index }: RowProps) {
  const editPaints = usePaintEditor();
  const background = useContext(PaintTargetContext) === "backgroundFills";
  const prefix = background ? "Background " : "";
  const [open, setOpen] = useState(false);
  const p = paints[index];
  const tokens = doc.tokens ?? {};
  const label =
    p.type === "image"
      ? `Image · ${FITS.find((f) => f.value === (p.fit ?? "fill"))?.label}`
      : typeLabel(p);
  return (
    <Row
      index={index}
      type={p.type}
      open={open}
      tools={<RowTools selection={selection} paints={paints} index={index} />}
    >
      <DragGrip selection={selection} paints={paints} index={index} />
      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <PopoverAnchor asChild>
          <div data-color-anchor className={rowBox}>
            <button
              type="button"
              name={index === 0 && !background ? "color" : undefined}
              aria-label={`Edit ${prefix.toLowerCase()}${typeLabel(p).toLowerCase()} paint`}
              aria-expanded={open}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => setOpen(!open)}
            >
              <Swatch color={paintPreview(p, tokens)} />
              <span className="min-w-0 flex-1 truncate text-foreground">{label}</span>
            </button>
            {/* Wonder drops the % on gradient rows (opacity is per stop); an image paint keeps its own opacity. */}
            {p.type === "image" ? (
              <Field
                label={
                  background
                    ? `Background ${index === 0 ? "fill" : `paint ${index + 1}`} opacity`
                    : index === 0
                      ? "Fill opacity"
                      : `Paint ${index + 1} opacity`
                }
                numeric
                value={String(p.opacity ?? 100)}
                className={percentField}
                inputClassName="text-right"
                suffix="%"
                onCommit={(value) => {
                  const n = Number(value);
                  if (!Number.isFinite(n)) return "Enter a percentage";
                  const pct = Math.max(0, Math.min(100, n));
                  editPaints(
                    selection,
                    at(index, (q) => ({ ...q, opacity: pct === 100 ? undefined : pct })),
                  );
                }}
              />
            ) : null}
          </div>
        </PopoverAnchor>
        <PopoverContent
          id="color-dialog"
          side="left"
          align="start"
          sideOffset={16}
          collisionPadding={8}
          className="w-72"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if ((event.target as HTMLElement | null)?.closest?.("[data-color-anchor]"))
              event.preventDefault();
          }}
        >
          {p.type === "image" ? (
            <ImageEditor
              doc={doc}
              node={node}
              selection={selection}
              paints={paints}
              index={index}
              onClose={() => setOpen(false)}
            />
          ) : (
            <GradientEditor
              doc={doc}
              node={node}
              selection={selection}
              paints={paints}
              index={index}
              onClose={() => setOpen(false)}
            />
          )}
        </PopoverContent>
      </Popover>
    </Row>
  );
}

const KINDS: { value: "solid" | "gradient" | "image"; label: string; icon: IconType }[] = [
  { value: "solid", label: "Solid", icon: Square },
  { value: "gradient", label: "Gradient", icon: GradientPaintIcon },
  { value: "image", label: "Image", icon: ImageIcon },
];
const GRADIENTS = TYPES.filter((t) => isGradient({ type: t.value }));

/**
 * Wonder's paint type switch: three icons (solid, gradient, image) on the left of the picker's Custom / Variables row.
 * Linear / Radial / Conic is a select inside the gradient editor (`#paint-type`).
 */
function PaintTypeSwitch({ doc, selection, paints, index }: RowProps) {
  const editPaints = usePaintEditor();
  const p = paints[index];
  const tokens = doc.tokens ?? {};
  const kind = p.type === "solid" || p.type === "image" ? p.type : "gradient";
  const choose = (value: (typeof KINDS)[number]["value"]) => {
    if (value === kind) return;
    if (value === "image" && !p.src)
      return pickImage((image) =>
        editPaints(
          selection,
          at(index, (q) => ({ ...convert(q, "image", tokens), ...image })),
        ),
      );
    const type = value === "gradient" ? "linear" : value;
    editPaints(
      selection,
      at(index, (q) => convert(q, type, tokens)),
    );
  };
  return (
    <div
      role="radiogroup"
      aria-label="Paint type"
      data-paint-kind={kind}
      className="flex h-6 shrink-0 rounded-md bg-muted"
    >
      {KINDS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={kind === value}
          aria-label={label}
          title={label}
          className="flex w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring aria-checked:bg-accent aria-checked:text-foreground"
          onClick={() => choose(value)}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  );
}

/** Dynamic style through a ref (lint forbids inline style props in islands). */
function useRefStyle<T extends HTMLElement>(style: Partial<CSSStyleDeclaration>) {
  const ref = useRef<T>(null);
  const key = JSON.stringify(style);
  useLayoutEffect(() => {
    if (ref.current) Object.assign(ref.current.style, style);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return ref;
}

function StopMarker({
  stop,
  active,
  index,
  color,
  onSelect,
  onDrag,
}: {
  stop: Stop;
  active: boolean;
  index: number;
  color: string;
  onSelect: () => void;
  onDrag: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const ref = useRefStyle<HTMLButtonElement>({ left: `calc(${stop.position}% - 6px)` });
  return (
    <button
      ref={ref}
      type="button"
      aria-label={`Stop ${index + 1} at ${stop.position}%`}
      aria-pressed={active}
      data-stop={index}
      className="absolute top-0 flex size-3 touch-none items-center justify-center rounded-full ring-2 ring-primary-foreground shadow-menu aria-pressed:ring-ring"
      onClick={onSelect}
      onPointerDown={onDrag}
    >
      <Swatch color={color} className="size-2.5 rounded-full ring-0" />
    </button>
  );
}

const round = (v: number) => Math.round(v * 10) / 10;

/** Gradient editor: preview bar with draggable stops, angle, add/remove/reverse stops, stop colour + variable. */
function GradientEditor({
  doc,
  node,
  selection,
  paints,
  index,
  onClose,
}: RowProps & { onClose: () => void }) {
  const editPaints = usePaintEditor();
  const p = paints[index];
  const tokens = doc.tokens ?? {};
  const stops = p.stops ?? [];
  const [selected, setSelected] = useState(0);
  const current = Math.min(selected, stops.length - 1);
  const stop = stops[current];
  const bar = useRefStyle<HTMLDivElement>({
    background: paintPreview({ ...p, type: "linear", angle: 90 }, tokens),
  });
  const [drag, setDrag] = useState<{ i: number; position: number } | null>(null);
  const shown = drag
    ? stops.map((s, i) => (i === drag.i ? { ...s, position: drag.position } : s))
    : stops;
  const setStops = (fn: (s: Stop[]) => Stop[]) =>
    editPaints(
      selection,
      at(index, (q) => (q.stops ? { ...q, stops: fn(q.stops) } : q)),
    );
  const setStop = (i: number, fn: (s: Stop) => Stop) =>
    setStops((s) => s.map((x, j) => (j === i ? fn(x) : x)));
  const startDrag = (i: number) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const track = event.currentTarget.parentElement!;
    const r = track.getBoundingClientRect();
    const pos = (x: number) => round(Math.min(100, Math.max(0, ((x - r.left) / r.width) * 100)));
    let last: number | null = null;
    const moveTo = (e: PointerEvent) => {
      last = pos(e.clientX);
      setDrag({ i, position: last });
    };
    const up = () => {
      window.removeEventListener("pointermove", moveTo);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (last !== null) setStop(i, (s) => ({ ...s, position: last! }));
    };
    setSelected(i);
    window.addEventListener("pointermove", moveTo);
    window.addEventListener("pointerup", up);
  };
  const addStop = () => {
    // Midway between the selected stop and its neighbour, in the selected stop's colour.
    const sorted = [...stops].sort((a, b) => a.position - b.position);
    const k = sorted.indexOf(stop);
    const next = sorted[k + 1] ?? sorted[k - 1];
    const position = round(next ? (stop.position + next.position) / 2 : 50);
    setStops((s) => [...s, { position, color: resolved(stop, tokens) }]);
    setSelected(stops.length);
  };
  const header = (
    <div className="flex flex-col gap-2">
      <PaintTypeSwitch doc={doc} node={node} selection={selection} paints={paints} index={index} />
      {/* Wonder A1-background-gradient: "Linear ▾" with rotate and flip on one row, then the stop bar. */}
      <div className="flex items-center gap-1">
        <NativeSelect
          id="paint-type"
          label="Gradient type"
          value={p.type}
          className="min-w-0 flex-1"
          options={GRADIENTS}
          onChange={(value) =>
            editPaints(
              selection,
              at(index, (q) => convert(q, value as Paint["type"], tokens)),
            )
          }
        />
        {p.type !== "radial" ? (
          <Field
            label="Gradient angle"
            numeric
            value={String(p.angle ?? (p.type === "linear" ? 180 : 0))}
            suffix="°"
            className="w-16"
            onCommit={(value) => {
              const n = Number(value);
              if (!Number.isFinite(n)) return "Enter degrees";
              editPaints(
                selection,
                at(index, (q) => ({ ...q, angle: ((n % 360) + 360) % 360 })),
              );
            }}
          />
        ) : null}
        {p.type !== "radial" ? (
          <IconButton
            icon={RotateCw}
            label="Rotate gradient 90°"
            onClick={() =>
              editPaints(
                selection,
                at(index, (q) => ({
                  ...q,
                  angle: ((q.angle ?? (q.type === "linear" ? 180 : 0)) + 90) % 360,
                })),
              )
            }
          />
        ) : null}
        <IconButton
          icon={ArrowLeftRight}
          label="Reverse gradient stops"
          onClick={() =>
            setStops((s) => s.map((x) => ({ ...x, position: round(100 - x.position) })))
          }
        />
      </div>
      <div className="relative h-3 px-1.5">
        <div ref={bar} aria-hidden className="h-3 rounded-sm ring-1 ring-card" />
        <div className="absolute inset-x-1.5 top-0 h-3">
          {shown.map((s, i) => (
            <StopMarker
              key={i}
              stop={s}
              index={i}
              active={i === current}
              color={resolved(s, tokens)}
              onSelect={() => setSelected(i)}
              onDrag={startDrag(i)}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1" role="list" aria-label="Gradient stops">
        {stops.map((s, i) => (
          <div key={i} role="listitem" className="flex items-center gap-1" data-stop-row={i}>
            <button
              type="button"
              aria-label={`Select stop ${i + 1}`}
              aria-pressed={i === current}
              className="flex h-6 min-w-0 flex-1 items-center gap-2 rounded-md bg-input px-2 text-xs text-foreground shadow-field aria-pressed:ring-1 aria-pressed:ring-ring"
              onClick={() => setSelected(i)}
            >
              <Swatch color={resolved(s, tokens)} className="size-3.5" />
              <span className="min-w-0 flex-1 truncate text-left">
                {s.token ?? hexLabel(s.color)}
              </span>
            </button>
            <Field
              label={`Stop ${i + 1} position`}
              numeric
              value={String(s.position)}
              suffix="%"
              className="w-16"
              onCommit={(value) => {
                const n = Number(value);
                if (!Number.isFinite(n)) return "Enter a percentage";
                setStop(i, (x) => ({ ...x, position: round(Math.max(0, Math.min(100, n))) }));
              }}
            />
            {s.token ? (
              <IconButton
                icon={Unlink}
                label={`Detach stop ${i + 1} variable`}
                onClick={() =>
                  setStop(i, (x) => ({ position: x.position, color: resolved(x, tokens) }))
                }
              />
            ) : null}
            <IconButton
              icon={RemoveIcon}
              label={`Remove stop ${i + 1}`}
              disabled={stops.length <= 2}
              onClick={() => {
                setStops((x) => x.filter((_, j) => j !== i));
                setSelected(0);
              }}
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={stops.length >= 16}
        className="flex h-6 items-center gap-2 self-start rounded-md px-1 text-xs text-foreground-3 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
        onClick={addStop}
      >
        <Plus className="size-4" aria-hidden />
        Add stop
      </button>
    </div>
  );
  if (!stop) return null;
  return (
    <ColorPicker
      key={current}
      title="Gradient"
      header={header}
      headTools={<MoveTools selection={selection} paints={paints} index={index} />}
      value={resolved(stop, tokens)}
      onCommit={(color) =>
        stop.token
          ? editVariable(stop.token, color)
          : setStop(current, (s) => ({ position: s.position, color }))
      }
      onDetach={
        stop.token
          ? () => setStop(current, (s) => ({ position: s.position, color: resolved(s, tokens) }))
          : undefined
      }
      tokens={tokens}
      token={stop.token}
      onToken={(name) =>
        setStop(current, (s) => ({ ...s, color: tokens[name] ?? s.color, token: name }))
      }
      onClose={onClose}
    />
  );
}

/** Image paint: preview, replace, fit (Fill / Cover / Contain / None). */
function ImageEditor({
  doc,
  node,
  selection,
  paints,
  index,
  onClose,
}: RowProps & { onClose: () => void }) {
  const editPaints = usePaintEditor();
  const p = paints[index];
  const preview = useRefStyle<HTMLDivElement>({ background: paintPreview(p, doc.tokens ?? {}) });
  return (
    <div className="flex flex-col gap-2">
      <div className="-mt-1 flex h-7 items-center gap-1">
        <strong className="min-w-0 flex-1 text-xs font-normal text-foreground">Image</strong>
        <MoveTools selection={selection} paints={paints} index={index} />
        <IconButton icon={X} label="Close paint editor" onClick={onClose} />
      </div>
      <PaintTypeSwitch doc={doc} node={node} selection={selection} paints={paints} index={index} />
      <div ref={preview} aria-hidden className="h-32 rounded-md ring-1 ring-card" />
      <div className="grid grid-cols-2 gap-2">
        <NativeSelect
          id="paint-image-fit"
          label="Image fit"
          value={p.fit ?? "fill"}
          options={FITS}
          onChange={(value) =>
            editPaints(
              selection,
              at(index, (q) => ({ ...q, fit: value as Paint["fit"] })),
            )
          }
        />
        <button
          type="button"
          className="flex h-6 items-center justify-center gap-1 rounded-md bg-input text-xs text-foreground shadow-field hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() =>
            pickImage((image) =>
              editPaints(
                selection,
                at(index, (q) => ({ ...q, ...image })),
              ),
            )
          }
        >
          <ImageIcon className="size-3.5" aria-hidden />
          Replace…
        </button>
      </div>
    </div>
  );
}
