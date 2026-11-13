/* oxlint-disable shadcn/no-restyle -- Wonder draws this tooltip as a dark bordered chip without an arrow
   (properties-audit wonder/H6-tooltip-confirmed), not the shared inverted bubble. */
// Shader mode (properties-audit H6): the wavy square in a Background Fill header is a pressed toggle titled
// "Shader mode". On, the layer's fill is painted by a shader (`shaderFill: true` + the shader fields the
// `shader` layer type uses); the preset dropdown and the preset's colours replace the paint rows (ShaderFill),
// and the canvas mounts the shader surface under the layer's content (web/shaders.js). Off keeps the stored
// preset and paints, so toggling back restores both.
import { ShaderIcon } from "@/components/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { IconButton } from "./controls";
import { patchNodes, type Node } from "./model";
import type { PaintTarget } from "./paints";
import { defaultFillPreset, isParam } from "./shader-library";

/**
 * Whether Shader mode applies to this stack: a box's Background Fill, or the Background Fill behind a text
 * layer's glyphs. Shader layers are shaders already; a Text Fill (the glyphs) cannot be a shader.
 */
export const shaderModeApplies = (node: Node, target: PaintTarget) =>
  target === "backgroundFills"
    ? node.type === "text"
    : node.type !== "text" && node.type !== "shader";

/** Turn Shader mode on or off for every selected layer it applies to (one undo step). */
export function setShaderMode(selection: string[], target: PaintTarget, on: boolean) {
  const preset = defaultFillPreset();
  patchNodes(selection, (n) => {
    if (!shaderModeApplies(n, target)) return {};
    if (!on) return { shaderFill: undefined };
    // Keep a preset the layer already chose; a layer still on the node default starts on the first
    // parametric preset (its colours are what the mode shows). The older animated gradient is replaced.
    const keep = isParam(n.shaderPreset) || (n.shaderPreset && n.shaderPreset !== "aurora");
    return {
      shaderFill: true,
      animated: "",
      ...(keep || !preset
        ? {}
        : {
            shaderPreset: preset.id,
            shaderSpeed: preset.defaults.speed,
            shaderColors: undefined,
            shaderParams: undefined,
          }),
    };
  });
}

export function ShaderModeToggle({
  node,
  selection,
  target,
}: {
  node: Node;
  selection: string[];
  target: PaintTarget;
}) {
  const applies = shaderModeApplies(node, target);
  const on = applies && !!node.shaderFill;
  const button = (
    <IconButton
      icon={ShaderIcon}
      label="Shader mode"
      // The tooltip below replaces the native title.
      title=""
      aria-pressed={on}
      active={on}
      disabled={!applies}
      data-shader-mode={on ? "on" : "off"}
      className="data-active:bg-toggle-active data-active:text-toggle-active-foreground"
      onClick={() => setShaderMode(selection, target, !on)}
    />
  );
  if (!applies) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={6}
        className="rounded-lg border border-tab-edge bg-background px-2 py-1 text-xs text-foreground shadow-toolbar select-none [&>span]:hidden"
      >
        Shader mode
      </TooltipContent>
    </Tooltip>
  );
}
