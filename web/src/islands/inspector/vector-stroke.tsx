// Stroke section of a vector layer (docs/vector-nodes.md), shown in place of Border: width, colour (with colour
// variables), cap, join and dash pattern. The stroke is centred on the path and measured in layer pixels; it does not
// scale when the layer is resized. Document model (rendering in web/vector-geometry.js): strokeWidth, strokeColor /
// strokeToken, strokeHidden, strokeCap, strokeJoin, strokeDash. Every edit is one undo step.
import { Eye } from "lucide-react";
import { ClosedEyeIcon, RemoveIcon, StrokeWeightIcon } from "@/components/icons";
import type { DesignDocument } from "@/lib/bridge";
import { Field, IconAffix, IconButton, NativeSelect, OptionalSection } from "./controls";
import { EffectColorField } from "./effects";
import { fmt, patchNodes, type Node } from "./model";

type VectorNode = Node & {
  strokeToken?: string;
  strokeHidden?: boolean;
  strokeCap?: string;
  strokeJoin?: string;
  strokeDash?: number[];
};
type Props = { doc: DesignDocument; node: Node; selection: string[] };

const CAPS = [
  { value: "butt", label: "Butt cap" },
  { value: "round", label: "Round cap" },
  { value: "square", label: "Square cap" },
];
const JOINS = [
  { value: "miter", label: "Miter join" },
  { value: "round", label: "Round join" },
  { value: "bevel", label: "Bevel join" },
];
const RESET = {
  strokeWidth: 0,
  strokeToken: undefined,
  strokeHidden: undefined,
  strokeCap: undefined,
  strokeJoin: undefined,
  strokeDash: undefined,
};

/** "4 2" → [4, 2]; "" clears the dash. */
function readDash(raw: string): number[] | undefined | string {
  const text = raw.trim();
  if (!text) return undefined;
  const values = text.split(/[\s,]+/).map(Number);
  if (values.length > 16 || values.some((v) => !Number.isFinite(v) || v < 0 || v > 10000))
    return "Enter up to 16 lengths, such as 4 2.";
  return values.some((v) => v > 0) ? values : undefined;
}

export function VectorStrokeSection({ doc, node, selection }: Props) {
  const n = node as VectorNode;
  const tokens = doc.tokens ?? {};
  const width = typeof n.strokeWidth === "number" ? n.strokeWidth : 0;
  const hidden = n.strokeHidden === true;
  const color = n.strokeColor || "#000000";
  const patch = (values: Record<string, unknown>) => patchNodes(selection, () => values);
  return (
    <OptionalSection
      id="vector-stroke-section"
      title="Stroke"
      present={width > 0}
      onAdd={() => patch({ ...RESET, strokeWidth: 1, strokeColor: "#000000" })}
    >
      <div className="flex items-center gap-2">
        <Field
          name="strokeWidth"
          label="Stroke width"
          numeric
          value={fmt(width)}
          className="flex-1"
          prefix={<IconAffix icon={StrokeWeightIcon} />}
          onCommit={(raw) => {
            const value = Number(raw.trim());
            if (!raw.trim() || !Number.isFinite(value) || value < 0) return "Enter a number.";
            patch({ strokeWidth: value });
          }}
        />
        <IconButton
          icon={hidden ? ClosedEyeIcon : Eye}
          label={hidden ? "Show stroke" : "Hide stroke"}
          data-stroke-tool="visibility"
          onClick={() => patch({ strokeHidden: hidden ? undefined : true })}
        />
        <IconButton
          icon={RemoveIcon}
          label="Remove stroke"
          data-stroke-tool="remove"
          onClick={() => patch(RESET)}
        />
      </div>
      <EffectColorField
        row
        name="strokeColor"
        label="Stroke colour"
        value={color}
        tokens={tokens}
        token={n.strokeToken}
        onToken={(name) =>
          patch({ strokeColor: tokens[name] ?? color, strokeToken: name || undefined })
        }
        onCommit={(next) => patch({ strokeColor: next, strokeToken: undefined })}
      />
      <div className="grid grid-cols-2 gap-2">
        <NativeSelect
          name="strokeCap"
          label="Stroke cap"
          value={n.strokeCap || "butt"}
          options={CAPS}
          onChange={(next) => patch({ strokeCap: next === "butt" ? undefined : next })}
        />
        <NativeSelect
          name="strokeJoin"
          label="Stroke join"
          value={n.strokeJoin || "miter"}
          options={JOINS}
          onChange={(next) => patch({ strokeJoin: next === "miter" ? undefined : next })}
        />
      </div>
      <Field
        name="strokeDash"
        label="Dash pattern"
        value={(n.strokeDash ?? []).join(" ")}
        placeholder="Dash, e.g. 4 2"
        onCommit={(raw) => {
          const dash = readDash(raw);
          if (typeof dash === "string") return dash;
          patch({ strokeDash: dash });
        }}
      />
    </OptionalSection>
  );
}
