// Layer type icons for the layer tree. Glyphs come from lucide or the shared set in @/components/icons.
import {
  AppWindow,
  Circle,
  Frame,
  Image as ImageIcon,
  LayoutGrid,
  PenTool,
  Square,
  Star,
  Type,
  type LucideIcon,
} from "lucide-react";
import {
  ComponentInstanceIcon,
  ComponentMainIcon,
  ShaderIcon,
  SlotIcon,
  StackColumnIcon,
  StackRowIcon,
  type IconProps,
} from "@/components/icons";
import type { ComponentType } from "react";

const byType: Record<string, LucideIcon | ComponentType<IconProps>> = {
  text: Type,
  rectangle: Square,
  image: ImageIcon,
  shader: ShaderIcon,
  vector: PenTool,
  icon: Star,
};

/** Row icon for a layer; size comes from `className` (rows use `size-4`). */
export function LayerTypeIcon({
  node,
  className,
}: {
  node: {
    type: string;
    layout?: unknown;
    direction?: unknown;
    ellipse?: unknown;
    preview?: unknown;
    role?: string;
  };
  className?: string;
}) {
  // Components (Figma 25): filled four-diamond main, hollow diamond instance, square-plus slot.
  if (node.role === "main") return <ComponentMainIcon className={className} />;
  if (node.role === "instance") return <ComponentInstanceIcon className={className} />;
  if (node.role === "slot") return <SlotIcon className={className} />;
  // Preview audit PF7: a live preview frame is a browser window, not a frame.
  if (node.type === "frame" && node.preview) return <AppWindow className={className} />;
  if (node.type === "frame") {
    if (node.layout === "flex") {
      const Stack = node.direction === "column" ? StackColumnIcon : StackRowIcon;
      return <Stack className={className} />;
    }
    if (node.layout === "grid") return <LayoutGrid className={className} />;
    return <Frame className={className} />;
  }
  if (node.ellipse === true && node.type !== "text") return <Circle className={className} />;
  const Icon = byType[node.type] ?? Square;
  return <Icon className={className} />;
}
