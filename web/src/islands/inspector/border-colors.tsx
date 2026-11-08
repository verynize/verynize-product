// Border section (Wonder A2, design/wonder/properties-audit): one "All" border entry, or up to four side entries
// (Top / Right / Bottom / Left), each with width, side selector, eye, `−` and its own colour row. Header tools:
// Sliders (Solid / Dashed / Dotted), Sides (split into four entries / collapse back to All) and `+`. In All mode `+`
// splits into Top and Right (both keep the All values); each further `+` adds the next missing side (Bottom, then
// Left), and it is disabled once all four exist (Wonder H4). Every action is one document edit and one undo step.
//
// Document model (rendering in web/node-style.js):
//   All:   strokeWidth (+ optional width binding), strokeColor / strokeToken, strokeHidden.
//   Sides: strokeWidths [t, r, b, l] (a side with width 0 has no entry), strokeColors [{color, token?} x4],
//          strokeHiddenSides [bool x4] (each side's eye), strokeWidth = the widest side.
import { Eye } from "lucide-react";
import { BorderSidesIcon, ClosedEyeIcon, RemoveIcon, StrokeWeightIcon } from "@/components/icons";
import type { DesignDocument } from "@/lib/bridge";
import { BindableField } from "./bind";
import {
  Field,
  IconAffix,
  IconButton,
  NativeSelect,
  OptionalSection,
  type IconType,
} from "./controls";
import { EffectColorField, LineStyleMenu } from "./effects";
import { fmt, patchNodes, setField, type Node } from "./model";

type SideColor = { color: string; token?: string };
type BorderNode = Node & {
  strokeWidths?: unknown;
  strokeToken?: string;
  strokeColors?: SideColor[];
  strokeStyle?: string;
  strokeHidden?: boolean;
  strokeHiddenSides?: boolean[];
};
type Props = { doc: DesignDocument; node: Node; selection: string[] };
type Tokens = Record<string, string>;

const SIDES = ["Top", "Right", "Bottom", "Left"] as const;
const SIDE_OPTIONS = [{ value: "all", label: "All" }].concat(
  SIDES.map((side) => ({ value: side.toLowerCase(), label: side })),
);

/** Everything that describes a border; removing the border clears all of it (one undo step). */
export const BORDER_RESET = {
  strokeWidth: 0,
  strokeColor: "#000000",
  strokeWidths: undefined,
  strokeColors: undefined,
  strokeToken: undefined,
  strokeStyle: undefined,
  strokeHidden: undefined,
  strokeHiddenSides: undefined,
};
/** Wonder's new border: 1px, all sides, solid #000000 at 100%. */
export const BORDER_DEFAULT = { ...BORDER_RESET, strokeWidth: 1 };

const width = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
const four = (value: unknown): unknown[] | null =>
  Array.isArray(value) && value.length === 4 ? value : null;

/** The four side widths (the uniform width repeated in All mode). */
export function borderWidths(node: Node): number[] {
  const n = node as BorderNode;
  const sides = four(n.strokeWidths);
  return sides ? sides.map(width) : SIDES.map(() => width(n.strokeWidth));
}

export function hasBorder(node: Node) {
  return borderWidths(node).some((value) => value > 0) || !!node.bindings?.strokeWidth;
}

const sideColors = (node: BorderNode): SideColor[] | null =>
  four(node.strokeColors) ? (node.strokeColors as SideColor[]) : null;

/** Per-side mode: the layer has per-side widths or per-side colours. */
export const isSides = (node: Node) =>
  !!four((node as BorderNode).strokeWidths) || !!sideColors(node as BorderNode);

const uniformColor = (n: BorderNode, tokens: Tokens): SideColor =>
  n.strokeToken
    ? { color: tokens[n.strokeToken] ?? n.strokeColor ?? "#000000", token: n.strokeToken }
    : { color: n.strokeColor || "#000000" };
const colorsOf = (n: BorderNode, tokens: Tokens): SideColor[] =>
  sideColors(n)?.map((c) => ({ ...c })) ?? SIDES.map(() => uniformColor(n, tokens));
const hiddenOf = (n: BorderNode): boolean[] =>
  SIDES.map((_, i) => (n.strokeHidden === true ? true : four(n.strokeHiddenSides)?.[i] === true));
const clean = (c: SideColor): SideColor =>
  c.token ? { color: c.color, token: c.token } : { color: c.color };

/** The selection's bindings without the border width variable. */
function withoutWidthBinding(node: Node) {
  const rest = { ...node.bindings };
  delete rest.strokeWidth;
  return { bindings: Object.keys(rest).length ? rest : undefined };
}

type SideState = { widths: number[]; colors: SideColor[]; hidden: boolean[] };
const stateOf = (node: Node, tokens: Tokens): SideState => {
  const n = node as BorderNode;
  return { widths: borderWidths(n), colors: colorsOf(n, tokens), hidden: hiddenOf(n) };
};

/** Per-side state → document patch. Removing the last side removes the border. */
function sidesPatch(node: Node, { widths, colors, hidden }: SideState) {
  if (!widths.some((value) => value > 0)) return { ...BORDER_RESET, ...withoutWidthBinding(node) };
  const shown = hidden.map((h, i) => h && widths[i] > 0);
  return {
    strokeWidths: widths,
    strokeWidth: Math.max(...widths),
    strokeColors: colors.map(clean),
    strokeToken: undefined,
    strokeHidden: undefined,
    strokeHiddenSides: shown.some(Boolean) ? shown : undefined,
    ...withoutWidthBinding(node),
  };
}

/** One "All" entry from a side entry (collapsing keeps that side's width, colour and visibility). */
function uniformPatch(value: number, color: SideColor, hidden: boolean) {
  return {
    strokeWidth: value,
    strokeWidths: undefined,
    strokeColors: undefined,
    strokeColor: color.color,
    strokeToken: color.token,
    strokeHidden: hidden || undefined,
    strokeHiddenSides: undefined,
  };
}

/** The Sides tool glyph: Wonder draws the sides in use solid and the others dotted until all four exist. */
const sidesIcons = new Map<string, IconType>();
function sidesIcon(present: boolean[] | null): IconType {
  if (!present) return BorderSidesIcon;
  const key = present.map(Number).join("");
  let icon = sidesIcons.get(key);
  if (!icon) {
    const Icon: IconType = (props) => <BorderSidesIcon {...props} sides={present} />;
    sidesIcons.set(key, (icon = Icon));
  }
  return icon;
}

const firstSide = (widths: number[]) =>
  Math.max(
    0,
    widths.findIndex((value) => value > 0),
  );

export function BorderSection({ doc, node, selection }: Props) {
  const tokens = doc.tokens ?? {};
  const n = node as BorderNode;
  const present = hasBorder(node);
  const sides = present && isSides(node);
  const { widths, colors, hidden } = stateOf(node, tokens);
  const entries = SIDES.map((_, i) => i).filter((i) => widths[i] > 0);
  const full = sides && entries.length === 4;
  // Every edit reads the current layer, so multi-selections keep their own values (one undo step).
  const edit = (change: (state: SideState, node: Node) => Record<string, unknown>) =>
    patchNodes(selection, (current) => change(stateOf(current, tokens), current));
  const split = () => edit((state, current) => sidesPatch(current, state));
  const collapse = (index?: number) =>
    edit((state) => {
      const i = index ?? firstSide(state.widths);
      return uniformPatch(state.widths[i], state.colors[i], state.hidden[i]);
    });
  const editSide = (change: (state: SideState) => void) =>
    edit((state, current) => {
      change(state);
      return sidesPatch(current, state);
    });
  const add = () => {
    if (!present)
      return patchNodes(selection, (current) => ({
        ...BORDER_DEFAULT,
        ...withoutWidthBinding(current),
      }));
    // All covers every side, so `+` splits it into Top + Right (Wonder H4-plus-all); Bottom and Left have no
    // entry and draw nothing. With sides, it adds the first missing side like the first one.
    if (!sides)
      return edit((state, current) => {
        state.widths = state.widths.map((value, i) => (i < 2 ? value : 0));
        return sidesPatch(current, state);
      });
    edit((state, current) => {
      const missing = state.widths.findIndex((value) => !(value > 0));
      if (missing < 0) return {};
      const from = firstSide(state.widths);
      state.widths[missing] = state.widths[from] || 1;
      state.colors[missing] = { ...state.colors[from] };
      state.hidden[missing] = false;
      return sidesPatch(current, state);
    });
  };
  const strokeStyle = n.strokeStyle || "solid";

  const entry = (index: number | null) => {
    const side = index === null ? null : SIDES[index];
    const isHidden = index === null ? n.strokeHidden === true : hidden[index];
    const thing = side ? `${side.toLowerCase()} border` : "border";
    const widthField =
      index === null ? (
        <BindableField
          doc={doc}
          node={node}
          selection={selection}
          field="strokeWidth"
          label="Border width"
          prefix={<IconAffix icon={StrokeWeightIcon} />}
        >
          {(suffix) => (
            <Field
              name="strokeWidth"
              label="Border width"
              numeric
              value={fmt(widths[0])}
              onCommit={(raw) => setField(selection, node, "strokeWidth", raw)}
              prefix={<IconAffix icon={StrokeWeightIcon} />}
              suffix={suffix}
            />
          )}
        </BindableField>
      ) : (
        <Field
          name={`strokeWidths-${index}`}
          label={`${side} border width`}
          numeric
          value={fmt(widths[index])}
          prefix={<IconAffix icon={StrokeWeightIcon} />}
          onCommit={(raw) => {
            const value = Number(raw.trim());
            if (!raw.trim() || !Number.isFinite(value)) return "Enter a number.";
            editSide((state) => {
              state.widths[index] = Math.max(0, value);
            });
          }}
        />
      );
    return (
      <div
        key={side ?? "all"}
        className="flex flex-col gap-2"
        data-border-entry={side ? side.toLowerCase() : "all"}
        data-border-side={side ? side.toLowerCase() : undefined}
      >
        <div
          className="flex items-center gap-2"
          data-border-row
          data-hidden={isHidden || undefined}
        >
          <div className="min-w-0 flex-1">{widthField}</div>
          <NativeSelect
            name={index === null ? "strokeSide" : `strokeSide-${index}`}
            label={side ? `${side} border side` : "Border side"}
            value={side ? side.toLowerCase() : "all"}
            options={SIDE_OPTIONS.map((option, i) => ({
              ...option,
              // A side another entry already draws cannot be picked twice.
              disabled: i > 0 && i - 1 !== index && sides && widths[i - 1] > 0,
            }))}
            className="flex-1"
            onChange={(next) => {
              const to = SIDES.findIndex((s) => s.toLowerCase() === next);
              if (index === null) {
                if (to < 0) return;
                // All → one side: that side keeps the width, colour and visibility.
                edit((state, current) => {
                  const keep = state.widths[0];
                  state.widths = SIDES.map((_, i) => (i === to ? keep : 0));
                  state.hidden = SIDES.map((_, i) => i === to && state.hidden[i]);
                  return sidesPatch(current, state);
                });
              } else if (to < 0) collapse(index);
              else
                editSide((state) => {
                  state.widths[to] = state.widths[index];
                  state.colors[to] = state.colors[index];
                  state.hidden[to] = state.hidden[index];
                  state.widths[index] = 0;
                  state.hidden[index] = false;
                });
            }}
          />
          <IconButton
            icon={isHidden ? ClosedEyeIcon : Eye}
            label={(isHidden ? "Show " : "Hide ") + thing}
            data-border-tool="visibility"
            onClick={() =>
              index === null
                ? patchNodes(selection, () => ({ strokeHidden: isHidden ? undefined : true }))
                : editSide((state) => {
                    state.hidden[index] = !state.hidden[index];
                  })
            }
          />
          <IconButton
            icon={RemoveIcon}
            label={"Remove " + thing}
            data-border-tool="remove"
            onClick={() =>
              index === null
                ? patchNodes(selection, (current) => ({
                    ...BORDER_RESET,
                    ...withoutWidthBinding(current),
                  }))
                : editSide((state) => {
                    state.widths[index] = 0;
                    state.hidden[index] = false;
                  })
            }
          />
        </div>
        {index === null ? (
          <EffectColorField
            row
            name="strokeColor"
            label="Border colour"
            value={n.strokeColor || "#000000"}
            tokens={tokens}
            token={n.strokeToken}
            onToken={(name) =>
              patchNodes(selection, () => ({
                strokeColor: tokens[name] ?? n.strokeColor ?? "#000000",
                strokeToken: name || undefined,
              }))
            }
            onCommit={(next) =>
              patchNodes(selection, () => ({ strokeColor: next, strokeToken: undefined }))
            }
          />
        ) : (
          <EffectColorField
            row
            name={`strokeColor${side}`}
            label={`${side} border colour`}
            value={colors[index].color}
            tokens={tokens}
            token={colors[index].token}
            onToken={(name) =>
              editSide((state) => {
                state.colors[index] = name
                  ? { color: tokens[name] ?? state.colors[index].color, token: name }
                  : { color: state.colors[index].color };
              })
            }
            onCommit={(next) =>
              editSide((state) => {
                state.colors[index] = { color: next };
              })
            }
          />
        )}
      </div>
    );
  };

  return (
    <OptionalSection
      id="border-section"
      title="Border"
      present={present}
      onAdd={add}
      addWhenPresent
      addLabel="Add border side"
      addDisabled={full}
      tools={
        <>
          <LineStyleMenu
            label="Border settings"
            name="strokeStyle"
            value={strokeStyle}
            onChange={(next) =>
              patchNodes(selection, () => ({ strokeStyle: next === "solid" ? undefined : next }))
            }
          />
          <IconButton
            icon={sidesIcon(sides && !full ? widths.map((value) => value > 0) : null)}
            label="Independent border sides"
            active={sides}
            aria-pressed={sides}
            onClick={() => (sides ? collapse() : split())}
          />
        </>
      }
    >
      {/* 32px pitch inside an entry, 44px between entries (Wonder A2 individual sides). */}
      <div className="flex flex-col gap-5">
        {sides ? entries.map((i) => entry(i)) : entry(null)}
      </div>
    </OptionalSection>
  );
}
