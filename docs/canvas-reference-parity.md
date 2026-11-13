# Canvas reference work

Inspected supplied screenshots in `desain/wonder/`: 22-design-panel, 23-color-picker, 25-typography, 41-variables, 43-frame-properties, 45-export-options, 46-export-format, 56-shader-presets, and 89-final-design.

Implemented corresponding workflows:

- Geometry and appearance: rotation, opacity, border width/color, clipping, CSS shadows, line height/letter spacing, flex alignment.
- Align left/center/right/top/middle/bottom and equal-gap horizontal/vertical distribution for siblings. Dimension badge and Alt-hover spacing readout.
- Color dialog: saturation/value surface, hue, opacity and hex entry. Bound variables remain separate and editing a literal fill detaches the binding.
- Live 3×2 WebGL preset gallery with independently authored Aurora, Waves, Noise, Glass Ribbon, Mesh Flow and Swirl algorithms. These are not vendor shader code or exact visual matches.
- Selection/page exports at 1×–3×: PNG via native Chromium rendering, JPG/WebP conversion, SVG with XHTML foreignObject layout and shader bitmap snapshots, HTML with authored shader runtime.
- Saved-view API and preference-based keyboard nudge increments/classic selection.

`tests/canvas-precision.cjs` verifies real appearance styles, alignment geometry, raster output dimensions/formats, color controls, and live gallery selection. Integration suites preserve new appearance properties and shader settings through native/CLI/MCP exports.

Limits: SVG output preserves browser layout through foreignObject, not fully flattened vector paths; consumers need foreignObject support. Shadows may extend beyond selected bounds; export bounds follow transformed layer boxes. Gradient algorithms are independent approximations. Full curve/vector editing remains outside this implementation.

Selection chrome now matches the reference's four corner grips and name above the layer. All four grips resize, retain the opposite corner for free positioning, and account for the layer's rotation and ancestor rotations. Flow-layout children resize within their parent's layout. The name is drawn outside the node so content clipping cannot hide it. `tests/canvas-resize.cjs` verifies all four corners, rotated anchoring, minimum dimensions, and the name in Electron; baseline and precision suites also pass. Handles on clipped layers are partially clipped at the content boundary; full independent overlay handles remain a minor refinement.

## Canvas interaction parity (infinite canvas, tools, guides, clipboard)

Implemented in `web/canvas-interactions.js` (installed by `web/app.js` through `BetterCanvas.install(editor)`) with styles in `web/canvas.css`. Covered by `tests/canvas-interactions.cjs`, which is part of `npm run test:canvas`.

- **Infinite canvas and camera.** `#canvas` is now a world-space layer with a `translate + scale` camera, replacing the fixed 1000×700 scroll box. Existing documents load with their frames at their stored coordinates. Documents without a top-level frame keep the legacy 1000×700 board as a backdrop at the world origin. Controls:
  - Cursor-anchored wheel and pinch zoom: ⌘/Ctrl-wheel, plus trackpad pinch, which arrives as ctrl-wheel. The factor is `1.002^(−Δ·k)`, with k = 8 for small trackpad deltas.
  - Zoom stops 2–3200%, stepped by ⌘+ and ⌘−. ⌘0 or ⇧0 sets 100%, ⇧1 fits to content, ⇧2 zooms to the selection.
  - Pan with trackpad or wheel scroll (Shift+wheel scrolls horizontally), Space-drag, middle mouse, or the H tool.
  - The camera is remembered per page for the session. The initial view fits to content and is capped at 100%.
  - `scrollIntoView` on a layer becomes a camera pan.

  Zoom is capped at 3200% (not Wonder's 20000%) because rendering is DOM-based. Selection outlines and handles stay a constant size in screen space.

- **Tools and shortcut registry.** A single registry of `{id,label,section,keys,run}` drives keyboard handling, the right-click context menu, and `window.design.commands()` / `runCommand(id)`. Tools:
  - V move, K scale (resize scales content, fonts, radius, gap and padding), H hand.
  - F frame, R rectangle, T text and S shader: drag to draw, or click to create at a default size. A new layer is parented to the frame under the cursor, and the tool then returns to Move.
  - I opens the image picker.
  - The Frame tool shows the device presets from the spec.
  - Esc returns to Move first, then deselects.

  Toolbar insert buttons keep their one-click insert behavior. Inserts now land in the visible viewport.

- **Selection.**
  - Marquee from empty canvas; Shift adds.
  - Shift-click toggles.
  - Classic and deep click modes, with drill state. Double-click drills one level. Siblings inside the drilled frame are directly clickable. Drill state resets on deselect.
  - ↵ selects children, ⇧↵ or `\` selects the parent, Tab/⇧Tab cycles siblings, ⌘A selects all in scope.
- **Smart guides.**
  - While dragging, edges and centers snap to siblings and the parent within 6 screen px, with pink guide lines.
  - Equal-gap snapping reuses gaps between neighbors and centers between two neighbors, with labeled gap segments.
  - Alt-hover draws labeled distance lines to the hovered layer, or to all four parent edges.
  - ⌘/Ctrl while dragging disables snapping, and Shift locks the axis.
  - Alt-drag duplicates.
  - Resize supports Shift for aspect lock and Alt to resize from the center.
  - The old 4px grid rounding was removed; Wonder has no pixel grid.
- **Clipboard.**
  - ⌘C, ⌘X and ⌘V copy, cut and paste. A normal paste lands in place when that spot is visible and is centered in the viewport otherwise. A paste goes into a selected frame.
  - ⌘⇧V pastes in place.
  - ⌘D duplicates.
  - ⌥⌘C and ⌥⌘V copy and paste style (fill, token, gradient, radius, border, shadow, opacity, typography, mask).
  - The system clipboard carries JSON text (`format: "verynize/nodes"`), so layers can be pasted between documents and windows. Pasting plain text creates a text layer, and pasting an image creates an image layer.
  - Pasted content is validated before insertion.
- **Structure.**
  - ⌘G or ⌥⌘G frames the selection: a transparent frame at the union bounds, with children re-based. ⇧⌘G unframes, keeping page positions. This works from flex parents too.
  - ⇧A adds auto layout: it infers direction, gap and padding, orders children along the main axis, and makes the frame Hug. Selecting loose layers frames them first. ⌥⇧A removes auto layout and keeps the current positions.
  - ⌘] / ⌘[ and ⌥⌘] / ⌥⌘[ change z-order among siblings.
  - ⌘⇧H and ⌘⇧L toggle hide and lock, and layer rows have eye and lock toggles. Hidden layers are dimmed in the list. Locked layers ignore canvas hits, marquee and nudges.
  - Number keys 0–9 set opacity. ⌥A/D/H/W/V/S align and ⌃⌥H/V distribute.
  - Top-level frames show a draggable name label above them.
- **Sizing modes.** W and H each have a Fixed/Hug/Fill select.
  - Hug is offered for text and flow-layout frames. Fill is offered only inside flow parents (flex, grid, block, inline).
  - Fill maps to `flex: 1 1 0` on the main axis and `align-self: stretch` on the cross axis.
  - Measured sizes are written back to `w`/`h` so exports and tooling see real numbers.
  - The size badge shows the mode, for example `270 Fill × 50`.
  - Typing a W/H value returns that axis to Fixed.

### Schema notes

The document is still version 2. The changes are optional node fields plus wider saved-view limits:

- New optional node fields: `locked`, `hidden` (booleans), and `wMode`, `hMode` (`fixed | hug | fill`).
- Saved views gain optional exact camera offsets `x` and `y`. `scrollLeft` and `scrollTop` remain non-negative for older readers.
- Saved-view zoom accepts 0.02–32.

`integrations/design-store.mjs` was updated only for the saved-view zoom range and the optional `x`/`y`. Node fields need no store change because unknown node fields pass through. The headless HTML exporter (`integrations/export-html.mjs`) does not yet apply `hidden` or the sizing modes. Because `w` and `h` are kept in sync, Hug and Fill layers still export at their measured size.

### Not yet done

- Per-corner radius and per-side padding.
- Constraints.
- Animated zoom transitions.
- Snapping while resizing.
- Flex child reordering by drag.
- Paste-to-replace.
- Copy-as-code/PNG.
- A ⌘K palette (⌘K still opens file search).
