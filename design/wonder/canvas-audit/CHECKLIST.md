# Canvas parity audit: capture checklist (2026-10-31)

Shared checklist for two capture passes:

- Wonder: the live app, saved to `wonder/`.
- Verynize: Electron, saved to `verynize/`.

Name every screenshot `<id>-<state>.png` with the ids below, so the two sides pair up by filename (`pairs/`).

Capture at native 2×. Use the full window (1440×870 CSS) unless a tight crop is clearer. When you crop, keep the crop rectangle in the notes.

For every id, the notes must give:

- the steps;
- exact visible strings: menu items in order, separators, shortcuts, disabled state, submenu contents;
- measurements in CSS px: menu width, item height, padding, radius;
- sampled RGB values;
- a final line, either `Verdict: …` or `Verdict: not observable — …`.

The spec already in `docs/wonder-canvas-spec.md` §2 is partly inferred ([I]). Confirm or refute it with pixels.

## CM. Context menus (right-click)

- CM1 Empty canvas. Wonder: Select all ⌘A · Paste here · Hide left sidebar · Hide right sidebar.
- CM2 A frame on the canvas. Wonder: Add context ⌘L · Copy, Copy as ›, Copy link to selection · Select layer ›, Paste, Paste to replace, Paste over selection, Duplicate · Hide, Lock · Arrange › · Layout › · Set as file thumbnail. Capture each submenu open (CM2-copy-as, CM2-select-layer, CM2-arrange, CM2-layout).
- CM3 A text layer. CM4 a non-frame child (rectangle/image/shader). CM5 a multi-selection of 2+ layers.
- CM6 A hidden layer and a locked layer (labels change to Show/Unlock?).
- CM7 A row in the Layers panel. CM8 a row in the Pages panel. CM9 the frame name label above an artboard.
- CM10 Disabled states: Paste with an empty clipboard vs with something copied.

## T. Toolbar and tools

- T1 Each bottom-toolbar button: hover tooltip text and shortcut, active state (T1-move, T1-scale, T1-hand, T1-frame, T1-shader, T1-text, T1-view-a, T1-view-b, T1-plus).
- T2 The `+` menu contents. T3 the two view-toggle buttons (what they show/hide).
- T4 Cursor and canvas behaviour per tool: what click/drag does with Scale, Shader and Text.
- T5 The `?` button (bottom left) menu. T6 the zoom % label (bottom right): click/menu.

## S. Selection

- S1 Hover outline on an unselected layer, nested child hover.
- S2 Click (classic vs deep), double-click drill, Esc goes up a level, click on empty deselects.
- S3 Shift-click add/remove; marquee from empty canvas (does it select children inside frames?).
- S4 Selection chrome: handles, size badge text (Fixed / Hug / Fill variants), frame name label, the "+" add-to-chat chip at top-right, multi-select bounding box.

## TR. Transform

- TR1 Resize from corner/edge; Shift keeps aspect; Alt from centre. Badge during resize.
- TR2 Rotate (hover just outside a corner: cursor, then drag), with the inspector value.
- TR3 Arrow nudge 1 px, Shift+arrow 10 px.
- TR4 Smart guides and snapping while dragging next to a sibling; equal-spacing guide.
- TR5 Alt/Option hover distance readouts (node-to-node, child-to-parent).
- TR6 Alt-drag duplicate. TR7 drag into / out of a frame and an auto-layout (flex) parent: drop indicator, reorder.
- TR8 On-canvas padding/gap handles on a flex frame, if any.

## V. View / camera

- V1 Zoom in/out (⌘+ / ⌘−) stops, ⇧0 / ⇧1 / ⇧2, pinch/wheel around the cursor.
- V2 Space-drag and Hand pan. V3 zoom to fit / to selection result.
- V4 Rulers or pixel grid at high zoom (spec says none: confirm).

## K. Keyboard and clipboard

- K1 Keyboard shortcuts panel (if any, e.g. via `?`): capture every page.
- K2 Copy/paste, Paste here (at cursor), Duplicate ⌘D offset, Paste to replace, Paste over selection, Copy as › each option.
- K3 Group/frame selection (⌘G / ⌘⌥G), ungroup, delete, hide ⌘⇧H, lock ⌘⇧L.

## TX. Text on canvas

- TX1 Create text with T: click vs drag; default content, font and size; editing caret and selection colour; Esc to exit.

## L. Layers and pages panels (canvas-adjacent)

- L1 Layer row hover (eye/lock icons?), rename by double-click, drag-reorder indicator, expand/collapse.
- L2 Page add, rename, reorder, and delete confirmation.
