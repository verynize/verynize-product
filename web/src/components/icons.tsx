// Shared icon set for every island. Lucide (`lucide-react`) covers most glyphs; this file holds the glyphs Wonder
// draws differently. All outline icons render with a 1px stroke regardless of size (see `svg[data-icon]` and
// `svg.lucide` in styles/globals.css), so draw them on the lucide 24-unit grid with round caps and joins.
//
// Size scale by role (box size, measured from design/wonder at 1440×870):
//   size-3   (12px) disclosure chevrons (section headers, tree carets, select carets)
//   size-3.5 (14px) icons inside menus, chips, field prefixes, inline status
//   size-4   (16px) icon buttons: title bar, panel headers, section tools, row icons, hover actions
//   size-5   (20px) floating canvas toolbar
import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

export type IconProps = SVGProps<SVGSVGElement>;

function Glyph({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-icon=""
      {...props}
    >
      {children}
    </svg>
  );
}

/** Verynize logo mark (filled; 12px of ink at size-4 like Wonder's mark in 11/22). */
export function LogoIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path
        transform="matrix(1.2 0 0 1.2 -2.4 -2.4)"
        d="M5 4.5h7.2c3 0 5 1.6 5 4 0 1.4-.7 2.5-1.9 3.1 1.7.5 2.7 1.8 2.7 3.6 0 2.7-2.2 4.3-5.4 4.3H5V4.5Zm4.2 6h2.4c1.1 0 1.7-.5 1.7-1.3s-.6-1.3-1.7-1.3H9.2v2.6Zm0 6h3c1.2 0 1.9-.6 1.9-1.5s-.7-1.5-1.9-1.5h-3v3Z"
      />
    </svg>
  );
}

// Wonder's panel toggles (11, 22): a 14×10 rounded rectangle with a 4px rail on the panel's side, drawn in a 16px box.
const PANEL_RECT = { x: 2.25, y: 5.25, width: 19.5, height: 13.5, rx: 3.75 } as const;

/** Toggle for the left sidebar (title bar, sidebar header, page pill, chat dock). */
export function PanelLeftIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect {...PANEL_RECT} />
      <path d="M8.25 5.25v13.5" />
    </Glyph>
  );
}

/** Toggle for the right properties panel (panel header, floating pill). */
export function PanelRightIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect {...PANEL_RECT} />
      <path d="M15.75 5.25v13.5" />
    </Glyph>
  );
}

/** Details layout: canvas + right inspector (toolbar, layout menu). */
export function DetailsLayoutIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect {...PANEL_RECT} />
      <path d="M15.75 5.25v13.5M15.75 12h6" />
    </Glyph>
  );
}

/** Design layout: sidebar + canvas + inspector. */
export function DesignLayoutIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect {...PANEL_RECT} />
      <path d="M8.25 5.25v13.5M15.75 5.25v13.5M2.25 12h6M15.75 12h6" />
    </Glyph>
  );
}

/** Canvas layout: no panels. */
export function CanvasLayoutIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect {...PANEL_RECT} />
    </Glyph>
  );
}

/** Shader tool / shader layer: rounded square with two waves (22 toolbar). */
export function ShaderIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M6.5 10.5c1.4-2 2.9-2 4.3 0s2.9 2 4.3 0 2.4-1.6 2.4-1.6" />
      <path d="M6.5 15c1.4-2 2.9-2 4.3 0s2.9 2 4.3 0 2.4-1.6 2.4-1.6" />
    </Glyph>
  );
}

/** Auto-layout frame, vertical stack (Wonder's frame layer icon, 11). */
export function StackColumnIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="3.75" y="3.75" width="16.5" height="6.5" rx="3.25" />
      <rect x="3.75" y="13.75" width="10" height="6.5" rx="3.25" />
    </Glyph>
  );
}

/** Auto-layout frame, horizontal stack. */
export function StackRowIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="3.75" y="3.75" width="6.5" height="16.5" rx="3.25" />
      <rect x="13.75" y="3.75" width="6.5" height="10" rx="3.25" />
    </Glyph>
  );
}

/** Plus: Wonder's plus spans 18 of 24 units (12px in panel tools, 15px in the toolbar); lucide's spans 14. */
export function PlusIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 3v18M3 12h18" />
    </Glyph>
  );
}

/**
 * Box-model glyphs of the Layout section (Wonder's Padding / Margin fields, 2026-10-30/06, 15). Padding draws the
 * inset edge(s) inside a rounded square; margin draws them outside a smaller box (a tall box for left/right, a wide
 * one for top/bottom). `sides` lists the edges: t, r, b, l. All four sides (the "independent" toggles) use short bars.
 */
function BoxSides({ sides, outside, ...props }: IconProps & { sides: string; outside?: boolean }) {
  const all = sides.length === 4;
  const lr = sides === "lr",
    tb = sides === "tb";
  const box = !outside
    ? { x: 2.75, y: 2.75, w: 18.5, h: 18.5, r: 4 }
    : lr
      ? { x: 7, y: 3.5, w: 10, h: 17, r: 3.5 }
      : tb
        ? { x: 3.5, y: 7, w: 17, h: 10, r: 3.5 }
        : { x: 6.5, y: 6.5, w: 11, h: 11, r: 3 };
  const at = outside ? [2.5, 21.5] : [6.5, 17.5];
  const [lo, hi] = all ? (outside ? [8.5, 15.5] : [9.5, 14.5]) : outside ? [4, 20] : [6.5, 17.5];
  return (
    <Glyph {...props}>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={box.r} />
      {sides.includes("l") ? <path d={`M${at[0]} ${lo}v${hi - lo}`} /> : null}
      {sides.includes("r") ? <path d={`M${at[1]} ${lo}v${hi - lo}`} /> : null}
      {sides.includes("t") ? <path d={`M${lo} ${at[0]}h${hi - lo}`} /> : null}
      {sides.includes("b") ? <path d={`M${lo} ${at[1]}h${hi - lo}`} /> : null}
    </Glyph>
  );
}
export const PaddingXIcon = (props: IconProps) => <BoxSides sides="lr" {...props} />;
export const PaddingYIcon = (props: IconProps) => <BoxSides sides="tb" {...props} />;
export const PaddingLeftIcon = (props: IconProps) => <BoxSides sides="l" {...props} />;
export const PaddingTopIcon = (props: IconProps) => <BoxSides sides="t" {...props} />;
export const PaddingRightIcon = (props: IconProps) => <BoxSides sides="r" {...props} />;
export const PaddingBottomIcon = (props: IconProps) => <BoxSides sides="b" {...props} />;
export const PaddingSidesIcon = (props: IconProps) => <BoxSides sides="tlrb" {...props} />;
export const MarginXIcon = (props: IconProps) => <BoxSides sides="lr" outside {...props} />;
export const MarginYIcon = (props: IconProps) => <BoxSides sides="tb" outside {...props} />;
export const MarginLeftIcon = (props: IconProps) => <BoxSides sides="l" outside {...props} />;
export const MarginTopIcon = (props: IconProps) => <BoxSides sides="t" outside {...props} />;
export const MarginRightIcon = (props: IconProps) => <BoxSides sides="r" outside {...props} />;
export const MarginBottomIcon = (props: IconProps) => <BoxSides sides="b" outside {...props} />;
export const MarginSidesIcon = (props: IconProps) => <BoxSides sides="tlrb" outside {...props} />;

/* ---------- Layout section glyphs (design/wonder 22, 43, 2026-10-30/05, 06, 14) ---------- */

/** Display: free position (three loose circles). */
export function FreeLayoutIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="14.5" cy="7.5" r="3.25" />
      <circle cx="8.25" cy="16" r="3.25" />
      <circle cx="15.75" cy="16" r="3.25" />
    </Glyph>
  );
}

/** Display: flexbox (a tall item, a round item and a plus for the next one). */
export function FlexLayoutIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="4" y="3.75" width="6" height="16.5" rx="3" />
      <circle cx="16.5" cy="7" r="3.25" />
      <path d="M16.5 13v7.25M12.875 16.625h7.25" />
    </Glyph>
  );
}

/** Display: block flow (one rounded box). */
export function BlockLayoutIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="4" y="4" width="16" height="16" rx="4" />
    </Glyph>
  );
}

/** Display: grid (2 × 2 rounded cells). */
export function GridLayoutIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="3.75" y="3.75" width="7" height="7" rx="3" />
      <rect x="13.25" y="3.75" width="7" height="7" rx="3" />
      <rect x="3.75" y="13.25" width="7" height="7" rx="3" />
      <rect x="13.25" y="13.25" width="7" height="7" rx="3" />
    </Glyph>
  );
}

/** Two side-by-side pills: flex direction "row", grid column span. */
export function ColumnsIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="2" width="7.5" height="20" rx="3.75" />
      <rect x="13.5" y="2" width="7.5" height="20" rx="3.75" />
    </Glyph>
  );
}

/** Two stacked pills: flex direction "column", grid row span. */
export function RowsIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="2" y="3" width="20" height="7.5" rx="3.75" />
      <rect x="2" y="13.5" width="20" height="7.5" rx="3.75" />
    </Glyph>
  );
}

/** Column gap `)|(`. */
export function GapXIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M3 3h1.5a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H3M21 3h-1.5a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3H21M12 6.5v11" />
    </Glyph>
  );
}

/** Row gap (the column gap turned a quarter). */
export function GapYIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M3 3v1.5a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V3M3 21v-1.5a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3V21M6.5 12h11" />
    </Glyph>
  );
}

type Distribution = "around" | "between" | "evenly";
const DISTRIBUTE_AT: Record<Distribution, [number, number]> = {
  around: [8, 16],
  between: [5.5, 18.5],
  evenly: [9.5, 14.5],
};
/** A container with two items spread along its main axis (Wonder's distribution row). */
function Distribute({
  along,
  spread,
  ...props
}: IconProps & { along: "x" | "y"; spread: Distribution }) {
  const [a, b] = DISTRIBUTE_AT[spread];
  return (
    <Glyph {...props}>
      {along === "y" ? (
        <>
          <rect x="6" y="2" width="12" height="20" rx="3" />
          <path d={`M9.5 ${a}h5M9.5 ${b}h5`} />
        </>
      ) : (
        <>
          <rect x="2" y="6" width="20" height="12" rx="3" />
          <path d={`M${a} 9.5v5M${b} 9.5v5`} />
        </>
      )}
    </Glyph>
  );
}
export const DistributeAroundXIcon = (p: IconProps) => (
  <Distribute along="x" spread="around" {...p} />
);
export const DistributeBetweenXIcon = (p: IconProps) => (
  <Distribute along="x" spread="between" {...p} />
);
export const DistributeEvenlyXIcon = (p: IconProps) => (
  <Distribute along="x" spread="evenly" {...p} />
);
export const DistributeAroundYIcon = (p: IconProps) => (
  <Distribute along="y" spread="around" {...p} />
);
export const DistributeBetweenYIcon = (p: IconProps) => (
  <Distribute along="y" spread="between" {...p} />
);
export const DistributeEvenlyYIcon = (p: IconProps) => (
  <Distribute along="y" spread="evenly" {...p} />
);

/** Flex wrap: a line that runs right, turns down and comes back left. */
export function WrapIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M3.5 4.5h11.25a5.25 5.25 0 0 1 0 10.5H4" />
      <path d="m7.5 11.5-3.5 3.5 3.5 3.5" />
    </Glyph>
  );
}

/** Layout section header: add / remove auto layout (`-○-`). */
export function AutoLayoutIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="7.75" y="7.75" width="8.5" height="8.5" rx="4" />
      <path d="M1.5 12h6.25M16.25 12h6.25" />
    </Glyph>
  );
}

/** W/H size options: a box with two opposite corner marks. */
export function SizeOptionsIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="3.75" y="3.75" width="16.5" height="16.5" rx="4" />
      <path d="M7.5 11.5v-3a1 1 0 0 1 1-1h3M16.5 12.5v3a1 1 0 0 1-1 1h-3" />
    </Glyph>
  );
}

/** Rotation field prefix: an angle with a dotted arc. */
export function AngleIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M5 4.5V19h14.5" />
      <path d="M5 11a8 8 0 0 1 8 8" strokeDasharray="0.5 2.5" />
    </Glyph>
  );
}

/** Opacity field prefix: a box whose lower corner fades out in dots. */
export function OpacityIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="2.75" y="2.75" width="18.5" height="18.5" rx="4" />
      <path d="M17.5 17.5h.01M14.5 17.5h.01M11.5 17.5h.01M8.5 17.5h.01M17.5 14.5h.01M14.5 14.5h.01M11.5 14.5h.01M17.5 11.5h.01M14.5 11.5h.01M17.5 8.5h.01" />
    </Glyph>
  );
}

/** One rounded corner (top-left; `turn` rotates it to tr / br / bl) for the individual radius fields. */
function Corner({ turn, ...props }: IconProps & { turn: number }) {
  return (
    <Glyph {...props}>
      <path d="M6 19v-7a6 6 0 0 1 6-6h7" transform={`rotate(${turn} 12 12)`} />
    </Glyph>
  );
}
export const CornerTopLeftIcon = (p: IconProps) => <Corner turn={0} {...p} />;
export const CornerTopRightIcon = (p: IconProps) => <Corner turn={90} {...p} />;
export const CornerBottomRightIcon = (p: IconProps) => <Corner turn={180} {...p} />;
export const CornerBottomLeftIcon = (p: IconProps) => <Corner turn={270} {...p} />;

/** Claude agent mark (chat model chip, settings Agents). */
export function ClaudeMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={cn("size-3.5 shrink-0 text-chat-claude", className)}
    >
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        {[0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5].map((angle) => (
          <line key={angle} x1="8" y1="1.5" x2="8" y2="14.5" transform={`rotate(${angle} 8 8)`} />
        ))}
      </g>
    </svg>
  );
}

/** Codex agent mark (chat model chip, settings Agents). */
export function CodexMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={cn("size-3.5 shrink-0 text-chat-codex", className)}
    >
      <path
        fill="currentColor"
        d="M8 1.2c1.5 0 2.4.9 3 1.7 1 .1 2.2.6 2.7 1.9.5 1.3 0 2.4-.5 3.2.4.9.6 2.2-.3 3.3-.9 1-2.1 1.2-3 1.1-.6.8-1.6 1.4-2.9 1.4s-2.3-.6-2.9-1.4c-.9.1-2.1-.1-3-1.1-.9-1.1-.7-2.4-.3-3.3-.5-.8-1-1.9-.5-3.2.5-1.3 1.7-1.8 2.7-1.9.6-.8 1.5-1.7 3-1.7Z"
      />
      <path
        d="m5.6 6.4 1.6 1.6-1.6 1.6M8.6 9.8h2"
        stroke="var(--background)"
        strokeWidth="1.1"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Cursor agent placeholder mark: a shaded cube (onboarding, coming soon). */
export function CursorMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={cn("size-3.5 shrink-0 text-muted-foreground", className)}
    >
      <path fill="currentColor" opacity="0.35" d="M8 1.5 14 5v6l-6 3.5L2 11V5l6-3.5Z" />
      <path fill="currentColor" d="M8 8 14 5v6l-6 3.5V8Z" />
      <path d="M2 5l6 3 6-3M8 8v6.5" stroke="var(--background)" strokeWidth="0.8" fill="none" />
    </svg>
  );
}

/** Monochrome Figma mark (lucide no longer ships brand icons). */
export function FigmaIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M8.5 3h3.5v6H8.5a3 3 0 0 1 0-6Z" />
      <path d="M12 3h3.5a3 3 0 0 1 0 6H12V3Z" />
      <path d="M8.5 9H12v6H8.5a3 3 0 0 1 0-6Z" />
      <circle cx="15.5" cy="12" r="3" />
      <path d="M8.5 15H12v3a3 3 0 1 1-3.5-3Z" />
    </Glyph>
  );
}

/** Gradient paint type (Wonder's paint picker): rounded square filled with a dither of dots. */
export function GradientPaintIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M8 8h.01M12 8h.01M16 8h.01M10 10h.01M14 10h.01M8 12h.01M12 12h.01M16 12h.01M10 14h.01M14 14h.01M8 16h.01M12 16h.01M16 16h.01" />
    </Glyph>
  );
}

/* ---------- Effects (Shadow / Filters editors, WP-12) ---------- */

/** Box shadow row and segment: a dotted outer square around a solid inner square. */
export function BoxShadowIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" strokeDasharray="0.5 2.5" />
      <rect x="7.5" y="7.5" width="9" height="9" rx="1.5" />
    </Glyph>
  );
}

/** Drop shadow segment: a rounded square with a dotted copy offset below right. */
export function DropShadowIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="3.5" y="3.5" width="12" height="12" rx="3" />
      <path d="M18.5 8.5v7a5 5 0 0 1-5 5h-6" strokeDasharray="0.5 2.5" />
    </Glyph>
  );
}

/** Blur filter and shadow blur prefix: a fading grid of dots. */
export function BlurIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 3.5h.01M12 20.5h.01M3.5 12h.01M20.5 12h.01M7.5 5.5h.01M16.5 5.5h.01M7.5 18.5h.01M16.5 18.5h.01M5.5 7.5h.01M18.5 7.5h.01M5.5 16.5h.01M18.5 16.5h.01" />
      <path d="M9 9h.01M12 9h.01M15 9h.01M9 12h.01M12 12h.01M15 12h.01M9 15h.01M12 15h.01M15 15h.01" />
    </Glyph>
  );
}

/** Shadow spread prefix: a ring with dotted rays. */
export function SpreadIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3.5h.01M12 20.5h.01M3.5 12h.01M20.5 12h.01M6 6h.01M18 6h.01M6 18h.01M18 18h.01" />
    </Glyph>
  );
}

/** Numeric amount prefix (filter amount): a hash inside a rounded square. */
export function HashBoxIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M10 7.5 9 16.5M15 7.5l-1 9M7.5 10h9.5M7 14h9.5" />
    </Glyph>
  );
}

/** Border / Outline header settings tool (Wonder A2/A3): two vertical sliders. */
export function SlidersIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M8.5 4v8M8.5 16.5V20M15.5 4v3.5M15.5 12v8" />
      <circle cx="8.5" cy="14.25" r="2.25" />
      <circle cx="15.5" cy="9.75" r="2.25" />
    </Glyph>
  );
}

/** Border "individual sides" tool (Wonder A2): two nested rounded squares. */
/** Edges [top, right, bottom, left] of the Sides glyph's outer square, then the corner after each edge. */
const SIDE_EDGES = [
  "M7.25 3.75H16.75",
  "M20.25 7.25V16.75",
  "M16.75 20.25H7.25",
  "M3.75 16.75V7.25",
];
const SIDE_CORNERS = [
  "M16.75 3.75A3.5 3.5 0 0 1 20.25 7.25",
  "M20.25 16.75A3.5 3.5 0 0 1 16.75 20.25",
  "M7.25 20.25A3.5 3.5 0 0 1 3.75 16.75",
  "M3.75 7.25A3.5 3.5 0 0 1 7.25 3.75",
];

/**
 * Border "Sides" tool. With `sides` (some but not all borders drawn) it becomes Wonder's partial glyph
 * (H4-plus-all): the sides in use solid, the others dotted, no inner square.
 */
export function BorderSidesIcon({ sides, ...props }: IconProps & { sides?: boolean[] }) {
  if (sides) {
    const solid: string[] = [];
    const dotted: string[] = [];
    SIDE_EDGES.forEach((edge, i) => (sides[i] ? solid : dotted).push(edge));
    // A corner belongs to the solid stroke when either side meeting there is drawn.
    SIDE_CORNERS.forEach((corner, i) =>
      (sides[i] || sides[(i + 1) % 4] ? solid : dotted).push(corner),
    );
    return (
      <Glyph {...props} data-sides={sides.map(Number).join("")}>
        {dotted.length ? <path d={dotted.join("")} strokeDasharray="1 2.5" /> : null}
        {solid.length ? <path d={solid.join("")} /> : null}
      </Glyph>
    );
  }
  return (
    <Glyph {...props}>
      <rect x="3.75" y="3.75" width="16.5" height="16.5" rx="3.5" />
      <rect x="7.25" y="7.25" width="9.5" height="9.5" rx="1.5" />
    </Glyph>
  );
}

/** Stroke weight field prefix (Border / Outline width): a hairline over two pills of growing weight. */
export function StrokeWeightIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M2.5 4h19" />
      <rect x="2.5" y="8.5" width="19" height="4.5" rx="2.25" />
      <rect x="2.5" y="15.5" width="19" height="5.5" rx="2.75" />
    </Glyph>
  );
}

/** Outline offset field prefix: a double arrow between two bars (|↔|). */
export function OutlineOffsetIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M2 4v16M22 4v16M6 12h12M8.75 9.25 6 12l2.75 2.75M15.25 9.25 18 12l-2.75 2.75" />
    </Glyph>
  );
}

/* ---------- Position tools (properties-audit C1): Wonder's filled-pill align glyphs, rotate, flip, absolute ---------- */
/** One align glyph: a guide line with a short and a long pill. Drawn as "align left", mirrored / turned for the rest. */
function AlignBars({
  at,
  vertical,
  ...props
}: IconProps & { at: "start" | "center" | "end"; vertical?: boolean }) {
  const mirror = at === "end" ? "matrix(-1 0 0 1 24 0)" : "";
  return (
    <Glyph {...props}>
      <g transform={`${vertical ? "rotate(90 12 12) " : ""}${mirror}`}>
        {at === "center" ? (
          <>
            <path d="M12 3.5v3M12 10.5v3M12 17.5v3" />
            <rect x="8" y="6.5" width="8" height="4" rx="2" />
            <rect x="5.5" y="13.5" width="13" height="4" rx="2" />
          </>
        ) : (
          <>
            <path d="M4 3.5v17" />
            <rect x="7" y="6.5" width="8" height="4" rx="2" />
            <rect x="7" y="13.5" width="13" height="4" rx="2" />
          </>
        )}
      </g>
    </Glyph>
  );
}
export const AlignLeftBarsIcon = (p: IconProps) => <AlignBars at="start" {...p} />;
export const AlignCenterXBarsIcon = (p: IconProps) => <AlignBars at="center" {...p} />;
export const AlignRightBarsIcon = (p: IconProps) => <AlignBars at="end" {...p} />;
export const AlignTopBarsIcon = (p: IconProps) => <AlignBars at="start" vertical {...p} />;
export const AlignMiddleYBarsIcon = (p: IconProps) => <AlignBars at="center" vertical {...p} />;
export const AlignBottomBarsIcon = (p: IconProps) => <AlignBars at="end" vertical {...p} />;

/** Rotate 90°: a circle under a clockwise arrow. */
export function RotateRightIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="15.5" r="4.5" />
      <path d="M6.5 11.5a7 7 0 0 1 11-3.5M17.5 4.5V8H14" />
    </Glyph>
  );
}

/** Flip horizontal (▷|◁); `vertical` turns it for flip vertical. */
function Flip({ vertical, ...props }: IconProps & { vertical?: boolean }) {
  return (
    <Glyph {...props}>
      <g transform={vertical ? "rotate(90 12 12)" : undefined}>
        <path d="M12 3.5v17M3.5 8v8l4.5-4zM20.5 8v8L16 12z" />
      </g>
    </Glyph>
  );
}
export const FlipHorizontalIcon = (p: IconProps) => <Flip {...p} />;
export const FlipVerticalIcon = (p: IconProps) => <Flip vertical {...p} />;

/** Absolute position toggle: a square inside corner brackets. */
export function AbsolutePositionIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M3.5 8V6A2.5 2.5 0 0 1 6 3.5h2M16 3.5h2A2.5 2.5 0 0 1 20.5 6v2M20.5 16v2a2.5 2.5 0 0 1-2.5 2.5h-2M8 20.5H6A2.5 2.5 0 0 1 3.5 18v-2" />
      <rect x="8.5" y="8.5" width="7" height="7" rx="1" />
    </Glyph>
  );
}

/** Font size field prefix (Wonder A10): a large and a small A ("Aᴀ"). */
export function FontSizeIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M2.5 19 7.5 5.5 12.5 19M4.4 14h6.2M14 19l3.5-8 3.5 8M15.2 16.2h4.6" />
    </Glyph>
  );
}

/** Line height field prefix (Wonder A10): an A between a top bar and a baseline. */
export function LineHeightIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M5 4h14M5 20h14M7.5 17 12 7l4.5 10M9.2 13.5h5.6" />
    </Glyph>
  );
}

/** Vertical text alignment (Wonder A10): an arrow up to the top line. */
export function TextAlignTopIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M5 4h14M12 20V8M8 12l4-4 4 4" />
    </Glyph>
  );
}

/** Vertical text alignment (Wonder A10): two arrows meeting at the middle line. */
export function TextAlignMiddleIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M5 12h14M12 3v6M9.5 6.5 12 9l2.5-2.5M12 21v-6M9.5 17.5 12 15l2.5 2.5" />
    </Glyph>
  );
}

/** Vertical text alignment (Wonder A10): an arrow down to the bottom line. */
export function TextAlignBottomIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M5 20h14M12 4v12M8 12l4 4 4-4" />
    </Glyph>
  );
}

/** Text indent field prefix (Wonder A10 Type settings): a bar before a pill ("|▭"). */
export function TextIndentIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4.5 6v12" />
      <rect x="8.5" y="7.5" width="11" height="9" rx="4.5" />
    </Glyph>
  );
}

/* W/H sizing menu (properties-audit B2): drawn horizontally; the H menu turns the directional ones a quarter. */
/** Fixed size: a span between two end bars (`|—|`). */
export function SizeFixedIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 7v10M20 7v10M4 12h16" />
    </Glyph>
  );
}

/** Hug contents: two chevrons pointing in (`><`). */
export function SizeHugIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="m6 8 4 4-4 4M18 8l-4 4 4 4" />
    </Glyph>
  );
}

/** Auto size: a double arrow over an "A". */
export function SizeAutoIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M5 7h14M8 4.5 5 7l3 2.5M16 4.5 19 7l-3 2.5M8 20l4-9 4 9M9.5 17h5" />
    </Glyph>
  );
}

/** Calculate: "±" in a rounded square. */
export function SizeCalcIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M12 8v6M9 11h6M9 16.5h6" />
    </Glyph>
  );
}

/** Add min width: two arrows pointing at a centre bar (`→|←`). */
export function SizeMinIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 5v14M3 12h6M6.5 9.5 9 12l-2.5 2.5M21 12h-6M17.5 9.5 15 12l2.5 2.5" />
    </Glyph>
  );
}

/** Add max width: a double arrow between two end bars (`|↔|`). */
export function SizeMaxIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M3 6v12M21 6v12M7 12h10M9.5 9.5 7 12l2.5 2.5M14.5 9.5 17 12l-2.5 2.5" />
    </Glyph>
  );
}

/**
 * Hidden state of every visibility toggle (Wonder A1, A2, A11): the closed eye with lashes, not a slashed eye.
 * Lucide's EyeClosed already matches Wonder's glyph; one export keeps the inspector on the same icon.
 */
export { EyeClosed as ClosedEyeIcon } from "lucide-react";

/** Wonder's remove `−` (A1–A7): 12 px wide at size-4 (lucide Minus is 10 px). */
export function RemoveIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M3.5 12h17" />
    </Glyph>
  );
}

/** Main component (Figma 02/25 layer rows): four filled diamonds around the centre. */
export function ComponentMainIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" data-icon="" {...props}>
      <path
        stroke="none"
        d="m12 2.5 3.25 3.25L12 9 8.75 5.75 12 2.5ZM12 15l3.25 3.25L12 21.5l-3.25-3.25L12 15ZM5.75 8.75 9 12l-3.25 3.25L2.5 12l3.25-3.25ZM18.25 8.75 21.5 12l-3.25 3.25L15 12l3.25-3.25Z"
      />
    </svg>
  );
}

/** Instance of a component (Figma 11/25 layer rows): one hollow diamond. */
export function ComponentInstanceIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="m12 3.5 8.5 8.5-8.5 8.5L3.5 12 12 3.5Z" />
    </Glyph>
  );
}

/** Slot, a content region of a main component (Figma 09 layer rows): a square with a plus. */
export function SlotIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="4.5" y="4.5" width="15" height="15" rx="2" />
      <path d="M12 9v6M9 12h6" />
    </Glyph>
  );
}
