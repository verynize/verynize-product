// Selection colors (properties-audit A9; wonder A9-parent-colors, A9-selection-colors-bottom/-multiple,
// diagnostics/28-bottom): every distinct colour used by the selection and its descendants (fill and text paints,
// gradient stops, text background paints, text-range colours, border and side colours, outline, shadows, shader
// colours and SVG colours), one row each with a swatch and hex plus % (or a variable chip), and a target button
// that selects the layers using it. Editing a row recolours every use in one undo step ("Click to replace").
// Replaces the former SVG-only "Colors" section: SVG paints are rows here and keep their restore/detach tools.
import { useState } from "react";
import { RotateCcw, Target, Unlink } from "lucide-react";
import type { DesignDocument, LayerNode } from "@/lib/bridge";
import { ColorPopover } from "./color-picker";
import { VariableChip } from "./bind";
import { Field, IconButton, Section, Swatch } from "./controls";
import { alphaPercent, parseColor, toHex, withAlpha } from "./color";
import { HEX, hexLabel, pageNodes, parseHex, type Node } from "./model";
import { notify } from "./legacy";
import { monochromeSvgColor, svgPaints } from "./svg-colors";

type Holder = { color?: string; token?: string; opacity?: number };
type Tokens = Record<string, string>;
type AnyNode = Node & Record<string, unknown>;

/** One colour of a layer: how to read it and how to rewrite it inside a mutable copy of the layer's fields. */
type Use = {
  /** Colour as drawn (#rrggbb[aa], paint opacity folded into the alpha). */
  color: string;
  token?: string;
  /** Rewrite this use in `draft` (a mutable copy of the node's colour fields). */
  write: (draft: AnyNode, next: { color: string; token?: string }) => void;
  /** SVG uses can be restored to the original source colour. */
  svg?: boolean;
};

export type ColorGroup = {
  key: string;
  color: string;
  token?: string;
  /** Layers that use this colour. */
  ids: string[];
};

const normal = (color: string) => {
  const c = parseColor(color);
  return c ? toHex(c).toLowerCase() : null;
};
/** Fold a paint opacity (percent) into the colour's alpha. */
const fold = (color: string, opacity: number | undefined) =>
  opacity === undefined || opacity >= 100
    ? color
    : (withAlpha(color, (alphaPercent(color) * Math.max(0, opacity)) / 100) ?? color);
const resolvedOf = (h: Holder, tokens: Tokens) => (h.token && tokens[h.token]) || h.color || "";

/** A {color, token} holder (paint, stop, shadow, side colour, shader colour). */
function holderUse(
  h: Holder,
  tokens: Tokens,
  locate: (draft: AnyNode) => Holder | undefined,
  { paint = false }: { paint?: boolean } = {},
): Use | null {
  const color = resolvedOf(h, tokens);
  if (!HEX.test(color) && !h.token) return null;
  return {
    color: paint ? fold(color, h.opacity) : color,
    token: h.token || undefined,
    write: (draft, next) => {
      const target = locate(draft);
      if (!target) return;
      target.color = next.color;
      if (next.token) target.token = next.token;
      else delete target.token;
      // The new colour carries its own alpha; a paint opacity would apply twice.
      if (paint && !next.token) delete target.opacity;
    },
  };
}

/** Flat colour + token fields (`color`/`token`, `strokeColor`/`strokeToken`, `outlineColor`/`outlineToken`, SVG). */
function flatUse(
  node: AnyNode,
  tokens: Tokens,
  colorKey: string,
  tokenKey: string,
  { emptyToken = "" as string | undefined, fallback = "" } = {},
): Use | null {
  const token = typeof node[tokenKey] === "string" ? (node[tokenKey] as string) : "";
  const own = typeof node[colorKey] === "string" ? (node[colorKey] as string) : fallback;
  const color = (token && tokens[token]) || own;
  if (!HEX.test(color) && !token) return null;
  return {
    color,
    token: token || undefined,
    write: (draft, next) => {
      draft[colorKey] = next.color;
      draft[tokenKey] = next.token || emptyToken;
    },
  };
}

const bordered = (n: AnyNode) =>
  (typeof n.strokeWidth === "number" && n.strokeWidth > 0) ||
  (Array.isArray(n.strokeWidths) && n.strokeWidths.some((w) => typeof w === "number" && w > 0)) ||
  !!(n.bindings as Record<string, string> | undefined)?.strokeWidth;

/** Every colour use of one layer, in inspector order. */
export function colorUses(node: Node, tokens: Tokens): Use[] {
  const n = node as AnyNode;
  const uses: (Use | null)[] = [];
  const paintStack = (key: "fills" | "backgroundFills") => {
    const list = n[key];
    if (!Array.isArray(list)) return;
    list.forEach((p: Holder & { type?: string; stops?: Holder[] }, i) => {
      if (p?.type === "solid")
        uses.push(holderUse(p, tokens, (d) => (d[key] as Holder[])[i], { paint: true }));
      else if (Array.isArray(p?.stops))
        p.stops.forEach((s, j) =>
          uses.push(holderUse(s, tokens, (d) => (d[key] as { stops: Holder[] }[])[i].stops[j])),
        );
    });
  };
  // Fill / Text Fill: the paint stack, or the plain colour of older layers.
  if (Array.isArray(n.fills)) paintStack("fills");
  else uses.push(flatUse(n, tokens, "color", "token"));
  paintStack("backgroundFills");
  if (Array.isArray(n.textRuns))
    (n.textRuns as Holder[]).forEach((run, i) => {
      if (typeof run?.color === "string" && HEX.test(run.color))
        uses.push({
          color: run.color,
          write: (d, next) => {
            (d.textRuns as Holder[])[i].color = next.color;
          },
        });
    });
  if (bordered(n)) {
    if (Array.isArray(n.strokeColors) && n.strokeColors.length)
      (n.strokeColors as Holder[]).forEach((c, i) => {
        if (c && typeof c === "object")
          uses.push(holderUse(c, tokens, (d) => (d.strokeColors as Holder[])[i]));
      });
    else
      uses.push(
        flatUse(n, tokens, "strokeColor", "strokeToken", {
          emptyToken: undefined,
          fallback: "#000000",
        }),
      );
  }
  if (typeof n.outlineWidth === "number" && n.outlineWidth > 0)
    uses.push(
      flatUse(n, tokens, "outlineColor", "outlineToken", {
        emptyToken: undefined,
        fallback: "#000000",
      }),
    );
  if (Array.isArray(n.shadows))
    (n.shadows as Holder[]).forEach((s, i) => {
      if (s && typeof s === "object")
        uses.push(holderUse(s, tokens, (d) => (d.shadows as Holder[])[i]));
    });
  if (n.shaderColors && typeof n.shaderColors === "object")
    for (const role of Object.keys(n.shaderColors as object)) {
      const c = (n.shaderColors as Record<string, Holder>)[role];
      if (c && typeof c === "object")
        uses.push(holderUse(c, tokens, (d) => (d.shaderColors as Record<string, Holder>)[role]));
    }
  // SVG images: the one colour of a monochrome SVG, or each original paint of a multicolour one.
  const mono = monochromeSvgColor(node);
  if (mono) {
    const use = flatUse(n, tokens, "svgColor", "svgColorToken", {
      emptyToken: undefined,
      fallback: mono,
    });
    if (use) uses.push({ ...use, svg: true });
  } else
    for (const from of svgPaints(node)) {
      const map = (n.svgPaints as Record<string, string> | undefined) ?? {};
      uses.push({
        color: map[from] ?? from,
        svg: true,
        write: (d, next) => {
          const own = { ...(d.svgPaints as Record<string, string> | undefined) };
          const to = normal(next.color);
          if (!to || to === from) delete own[from];
          else own[from] = to;
          d.svgPaints = Object.keys(own).length ? own : undefined;
        },
      });
    }
  return uses.filter((u): u is Use => !!u);
}

const keyOf = (use: { color: string; token?: string }) =>
  use.token ? "token:" + use.token : (normal(use.color) ?? use.color);

/**
 * The layers a selection covers: the selected layers and all their descendants, children before their parent
 * (Wonder lists a frame's text colours before the frame's own paints: A9-parent-colors, diagnostics/28-bottom).
 */
export function coveredNodes(doc: DesignDocument, selection: string[]): Node[] {
  const nodes = pageNodes(doc);
  const wanted = new Set(selection);
  const seen = new Set<string>();
  const out: Node[] = [];
  const visit = (node: Node) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    for (const child of nodes) if (child.parentId === node.id) visit(child);
    out.push(node);
  };
  for (const node of nodes) if (wanted.has(node.id)) visit(node);
  return out;
}

/** Distinct colours of the selection and its descendants, first use first. */
export function selectionColors(doc: DesignDocument, selection: string[]): ColorGroup[] {
  const tokens = doc.tokens ?? {};
  const groups = new Map<string, ColorGroup>();
  for (const node of coveredNodes(doc, selection))
    for (const use of colorUses(node, tokens)) {
      const key = keyOf(use);
      const group = groups.get(key);
      if (group) {
        if (!group.ids.includes(node.id)) group.ids.push(node.id);
      } else groups.set(key, { key, color: use.color, token: use.token, ids: [node.id] });
    }
  return [...groups.values()];
}

/** Colour fields a use can rewrite; copied before an edit so patches never mutate the live document. */
const COLOR_FIELDS = [
  "color",
  "token",
  "fills",
  "backgroundFills",
  "textRuns",
  "strokeColor",
  "strokeToken",
  "strokeColors",
  "outlineColor",
  "outlineToken",
  "shadows",
  "shaderColors",
  "svgColor",
  "svgColorToken",
  "svgPaints",
] as const;

/** Rewrite every use of `key` across the given layers (one validated undo step). */
export function replaceColor(
  ids: string[],
  key: string,
  next: (use: Use) => { color: string; token?: string } | null,
) {
  if (!ids.length) return;
  const tokens = window.design.getDocument().tokens ?? {};
  try {
    window.design.updateNodes(ids, (live) => {
      const node = live as AnyNode;
      const draft = structuredClone(
        Object.fromEntries(COLOR_FIELDS.map((f) => [f, node[f]])),
      ) as AnyNode;
      let changed = false;
      for (const use of colorUses(node, tokens)) {
        if (keyOf(use) !== key) continue;
        const value = next(use);
        if (!value) continue;
        use.write(draft, value);
        changed = true;
      }
      if (!changed) return {};
      const patch: Record<string, unknown> = {};
      for (const f of COLOR_FIELDS)
        if (JSON.stringify(draft[f]) !== JSON.stringify(node[f])) patch[f] = draft[f];
      return patch as Partial<LayerNode>;
    });
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
  }
}

/** Show the section for a multi-selection, a layer with children, or an SVG image (Wonder never shows it for a lone leaf). */
export function showsSelectionColors(doc: DesignDocument, node: Node, selection: string[]) {
  if (selection.length > 1) return true;
  if (pageNodes(doc).some((n) => n.parentId === node.id)) return true;
  return !!monochromeSvgColor(node) || svgPaints(node).length > 0;
}

export function SelectionColorsSection({
  doc,
  node,
  selection,
}: {
  doc: DesignDocument;
  node: Node;
  selection: string[];
}) {
  if (!showsSelectionColors(doc, node, selection)) return null;
  const groups = selectionColors(doc, selection);
  if (!groups.length) return null;
  const covered = coveredNodes(doc, selection);
  const tokens = doc.tokens ?? {};
  const svgReplaced = covered.filter(
    (n) =>
      (monochromeSvgColor(n) && (n.svgColor !== undefined || n.svgColorToken !== undefined)) ||
      (n.svgPaints && typeof n.svgPaints === "object"),
  );
  const svgBound = covered.filter(
    (n) => typeof n.svgColorToken === "string" && monochromeSvgColor(n),
  );
  return (
    <Section
      id="selection-colors-section"
      title="Selection colors"
      bodyClassName="pt-2.25 pb-3.75"
      tools={
        // Wonder's header has no +/−; Verynize keeps its SVG tools here (only while they apply).
        svgBound.length || svgReplaced.length ? (
          <>
            {svgBound.length ? (
              <IconButton
                icon={Unlink}
                label="Detach SVG color variable"
                onClick={() =>
                  replaceSvg(svgBound, (n) => {
                    const own = typeof n.svgColor === "string" ? n.svgColor : monochromeSvgColor(n);
                    return {
                      svgColor: tokens[n.svgColorToken as string] || own,
                      svgColorToken: undefined,
                    };
                  })
                }
              />
            ) : null}
            {svgReplaced.length ? (
              <IconButton
                icon={RotateCcw}
                label="Restore original SVG colors"
                onClick={() =>
                  replaceSvg(svgReplaced, () => ({
                    svgColor: undefined,
                    svgColorToken: undefined,
                    svgPaints: undefined,
                  }))
                }
              />
            ) : null}
          </>
        ) : null
      }
    >
      <div className="flex flex-col gap-2" data-selection-colors={groups.length}>
        {groups.map((group, index) => (
          <ColorRow
            // Keyed by position: rebinding a row changes its colour key, and the open picker must stay open.
            key={index}
            index={index}
            group={group}
            tokens={tokens}
          />
        ))}
      </div>
    </Section>
  );
}

function replaceSvg(nodes: Node[], patch: (node: Node) => Record<string, unknown>) {
  try {
    window.design.updateNodes(
      nodes.map((n) => n.id),
      (n) => patch(n as Node) as Partial<LayerNode>,
    );
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
  }
}

function ColorRow({ index, group, tokens }: { index: number; group: ColorGroup; tokens: Tokens }) {
  const [open, setOpen] = useState(false);
  const n = index + 1;
  const color = group.token ? tokens[group.token] || group.color : group.color;
  const alpha = alphaPercent(color);
  const replace = (next: { color: string; token?: string }) =>
    replaceColor(group.ids, group.key, () => next);
  const commit = (value: string) => replace({ color: value });
  return (
    <div
      className="flex items-center gap-2"
      data-selection-color={group.key}
      data-selection-color-uses={group.ids.length}
    >
      <ColorPopover
        open={open}
        onOpenChange={setOpen}
        value={color}
        onCommit={commit}
        tokens={tokens}
        token={group.token}
        onToken={(name) => replace({ color: tokens[name] ?? color, token: name })}
      >
        <div
          data-color-anchor
          className="group/row flex h-6 min-w-0 flex-1 items-center gap-1 rounded-md bg-input pr-2 pl-1 text-xs shadow-field focus-within:ring-1 focus-within:ring-ring"
        >
          <button
            type="button"
            aria-label={`Selection color ${n}`}
            aria-expanded={open}
            title="Pick colour"
            onClick={() => setOpen(!open)}
            className="flex size-4.5 shrink-0 items-center justify-center rounded-sm focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Swatch color={color} />
          </button>
          {group.token ? (
            <>
              <button
                type="button"
                data-selection-color-token={group.token}
                aria-label={`Selection color ${n} variable ${group.token}`}
                title={
                  tokens[group.token]
                    ? `${group.token} = ${tokens[group.token]}`
                    : `${group.token} (missing variable)`
                }
                onClick={() => setOpen(!open)}
                className="-ml-px flex h-5 min-w-0 flex-1 items-center rounded-sm text-left focus-visible:ring-1 focus-visible:ring-ring"
              >
                <VariableChip name={group.token} missing={!tokens[group.token]} />
              </button>
              {/* Wonder's in-field unlink appears on hover only. */}
              <IconButton
                icon={Unlink}
                label={`Detach selection color ${n} variable`}
                className="-mr-1.5 hidden size-5 group-focus-within/row:inline-flex group-hover/row:inline-flex"
                iconClassName="size-3.5"
                onClick={() => replace({ color })}
              />
            </>
          ) : (
            <>
              <Field
                label={`Selection color ${n} hex`}
                value={hexLabel(color)}
                className="h-5 flex-1 bg-transparent px-0 shadow-none focus-within:ring-0"
                inputClassName="uppercase"
                onCommit={(value) => {
                  const hex =
                    parseHex(value, color) ??
                    (parseColor(value) ? toHex(parseColor(value)!) : null);
                  if (!hex) return "Use a hex colour such as A58BDD";
                  commit(hex);
                }}
              />
              <Field
                label={`Selection color ${n} opacity`}
                numeric
                value={String(alpha)}
                className="h-5 w-12 shrink-0 bg-transparent px-0 shadow-none focus-within:ring-0"
                inputClassName="text-right"
                suffix="%"
                onCommit={(value) => {
                  const pct = Number(value);
                  if (!value.trim() || !Number.isFinite(pct)) return "Enter a percentage";
                  const next = withAlpha(color, Math.max(0, Math.min(100, pct)));
                  if (!next) return "Enter a percentage";
                  commit(next);
                }}
              />
            </>
          )}
        </div>
      </ColorPopover>
      <IconButton
        icon={Target}
        label={`Select layers using selection color ${n}`}
        data-selection-color-target={group.key}
        onClick={() => window.design.setSelection(group.ids)}
      />
    </div>
  );
}
