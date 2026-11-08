# Wonder canvas/editor behavioral spec and Verynize parity gaps

Written 2026-10-28 against installed Wonder desktop 0.2.183. This is a description of behavior and interfaces, written from scratch. No Wonder source code is included. Verynize is an independent implementation.

## Evidence and confidence

- **Where the code lives.** `app.asar` holds only the Electron main/preload/chrome shell. The editor itself is a Svelte web app loaded from `app.wonder.so`. Its JS chunks were read statically from the local Chromium HTTP cache (`~/Library/Application Support/Wonder/Cache/Cache_Data`). They were brotli-decoded into `/tmp/wonder-canvas-cache/js` (329 chunks) and never executed. The chunks that matter are `command-actions-*`, `CommandManager-*`, `Renderer-*`, `file.svelte-*`, `commands-*`, `shortcuts-*`, `constants-*`, `camera-*`, `alignment-lines-*`, plus the PixiJS chunks (`WebGLRenderer-*`, `WebGPURenderer-*`, `CanvasRenderer-*`, `GraphicsContext-*`).
- **Screenshots used.** `desain/wonder/20, 22, 23, 25, 43, 56`.
- **Labels.** **[O]** means observed directly, either as a literal string or structure in the shipped bundle or in a screenshot. **[I]** means inferred from names or call sites. **[U]** means unknown.

---

## 1. Document and node model

### 1.1 Storage (Yjs)

- **[O]** One Yjs document per file and branch, synced with a Hocuspocus provider. Some collab frames are compressed.
- **[O]** Root maps:
  - `pageNodes`: node records, keyed per page/node.
  - `pages`
  - `docMeta`
  - `variables`: design tokens.
  - `icons`: icon-set bindings.
  - `renderHints`
- **[O]** Each node is stored as one JSON value under its key; it is not a deeply nested Y structure. Writes are size-checked: oversized records are refused and the editor is notified.
- **[I]** Concurrent edits to the same node therefore resolve last-writer-wins per node.
- **[O]** Presence (remote cursors and selections) is separate. The client has `canvas.selection.syncRemoteSelections` and `canvas.remote.update`.

### 1.2 Node record

- **[O]** Fields:
  - `id`, `shortId` (used for deep links and "copy link to selection")
  - `parentId`, `order` (sibling ordering), `pageId`
  - `name`, `label`, `isVisible`, `isLocked`, `isCollapsed` (layers panel)
  - `source.type`, `source.style`, `content`, `styleRanges` (rich-text runs)
- **[O] Node `type` values:**
  - `frame`: the general container. It doubles as a rectangle; there is no separate rect or ellipse primitive.
  - `text`
  - `svg`: inline SVG markup. Icons, Figma vectors, stars and polygons all become `svg`.
  - `image`
  - `shader`: `presetId`, `components[]`, `keyProps[]`
  - `html`
  - preview: a live localhost or published app embedded on the canvas
- **[O]** Not present as node types: groups, components/instances, vector or pen paths, booleans. "Frame selection" (⌘G) wraps the selection in a frame. Figma `vectorNetwork` and `STAR` data are converted to SVG on paste.
- **[O] The style model is CSS-shaped.** `source.style` contains:
  - **`layout`**:
    - `display`: block, flex or grid, plus an absolute/free mode
    - `position`
    - `top`, `left`, `right`, `bottom`
    - `width`, `height`. Each can be a number, `auto`, `%` or a calc expression.
    - `min*` and `max*` width and height
    - `aspectRatio`, `rotate`, `scale`. Scale carries x and y; a negative value means flipped.
    - `flexDirection`, `gap`, `gapX`, `gapY`, `alignItems`, `justifyContent`, `alignContent`, `justifyItems`, `flexShrink`
    - grid: `gridTemplateColumns`, `gridAutoFlow`, `gridColumnSpan`, `gridRowSpan`
    - `overflow` (`visible`, `clip`, `auto`, `scroll`)
    - `clipPath`
    - `verticalAlign`
  - **`spacing`**: padding and margin per side. Values can be a number, `{x, y}` or `{top, right, bottom, left}`.
  - **`fills[]`**: a stack of paints. Each paint is one of:
    - `solid`
    - `gradient` (linear, radial or conic, with stops)
    - `image`, with fit `cover`, `contain`, `fill` or `scale-down`
    - `shader`

    Each paint has `isVisible` and opacity.

  - **`typography`**: family, weight, size, line height, letter spacing, alignment (horizontal and vertical), white-space. It has its own fill stack (Text Fill).
  - **`border`**: per-side width and color stack. Corner radius is uniform or per-corner (`topLeft`, `topRight`, `bottomRight`, `bottomLeft`).
  - **`outline`**
  - **`effects`**: `boxShadow[]` (outer or inset), `dropShadow[]`, `textShadow[]`, and `filter[]`. The filter list contains:
    - `blur`
    - `brightness`
    - `contrast`
    - `grayscale`
    - `hueRotate`
    - `invert`
    - `saturate`
    - `sepia`
    - `dropShadow`
  - **Blend and opacity**: `opacity`, `mixBlendMode` (all 16 CSS modes plus `plus-darker` and `plus-lighter`), `backgroundBlendMode`.
  - **`tokenBindings`**: variable bindings per property.
  - Masks.
- **[O] Sizing modes** for W and H depend on context:
  - `Fixed` (px): always available.
  - `Relative` (%): only when the node has a parent.
  - `Hug`: text, SVG, or a node with flow children.
  - `Fill`: only when the node has a parent.
  - `Auto`: when the node has a parent, or is text or SVG.
  - `Calculate`: a CSS expression, behind a feature flag.
  - When several nodes are selected, only the modes they all share are offered. A `Mixed` label appears when they differ.
- **[I] Constraints are CSS anchoring.** The Position section has "Left/Top" dropdowns: horizontal anchor is left, right, left+right or center; vertical anchor is top, bottom, top+bottom or center. It also has a constraint diagram and a Z field with an `Auto` value (z-index).

## 2. Tools and interactions

### 2.1 Toolbar

- **[O]** The bottom floating toolbar has three groups:
  1. Move (V), Scale (K), Hand (H)
  2. Frame (F), Shader (S), Text (T)
  3. View toggles, and `+`

  Eye dropper is I, or ⌃C on mac. Space gives a temporary hand.

- **[O]** The Frame tool has device presets. **[I]** These are offered on drag or click while the tool is active:

  | Group        | Presets (width × height)                                                                                                                    |
  | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
  | Smartphone   | iPhone 17 402×874; iPhone 18 Pro 402×874; iPhone Air 420×912; iPhone 18 Pro Max 440×956; iPhone Duo Folded 466×678; iPhone Duo Open 626×890 |
  | Tablet       | iPad Air 11" 820×1180; iPad Mini 8.3" 744×1133                                                                                              |
  | Desktop      | MacBook Air 1280×832; MacBook Pro 14" 1512×982; MacBook Pro 16" 1728×1117; Desktop 1920×1080; TV 3840×2160                                  |
  | Presentation | Slide 16:9 1920×1080; Slide 4:3 1024×768                                                                                                    |
  | Smartwatch   | (sizes not captured)                                                                                                                        |

### 2.2 Keyboard map [O]

- **Edit**

  | Action                      | Key            |
  | --------------------------- | -------------- |
  | Copy / Cut / Paste          | ⌘C / ⌘X / ⌘V   |
  | Copy as code                | ⌘⇧C            |
  | Copy styles                 | ⌘⌥C            |
  | Copy prompt                 | ⌘⇧⌥C           |
  | Paste styles                | ⌘⌥V            |
  | Paste to replace            | ⌘⇧R            |
  | Paste over selection        | ⌘⇧V            |
  | Duplicate                   | ⌘D             |
  | Delete                      | ⌫              |
  | Undo / Redo                 | ⌘Z / ⌘⇧Z or ⌘Y |
  | Select all / Select inverse | ⌘A / ⌘⇧A       |
  | Rename                      | F2             |
  | Rename layer                | ⌘R             |
  | Find layer                  | ⌘F             |

- **Selection**

  | Action                         | Key        |
  | ------------------------------ | ---------- |
  | Cycle siblings                 | Tab / ⇧Tab |
  | Select child / parent          | ↵ / ⇧↵     |
  | Move selection up to parent    | `\`        |
  | Deselect                       | Esc        |
  | Peek behind backgrounds (hold) | ⇧          |

- **View**

  | Action                  | Key             |
  | ----------------------- | --------------- |
  | Zoom in / out           | ⌘+ / ⌘−         |
  | Zoom to 100%            | ⇧0              |
  | Zoom to fit             | ⇧1              |
  | Zoom to selection       | ⇧2              |
  | Next / previous frame   | N / ⇧N          |
  | Zoom by scroll          | ⌘-scroll        |
  | Toggle sidebars         | ⌘.              |
  | Hide or show all panels | ⌘\              |
  | Toggle visibility       | ⌘⇧H             |
  | Toggle lock             | ⌘⇧L             |
  | Collapse all layers     | ⌥L              |
  | Set opacity             | number keys 0–9 |
  | Next / previous page    | PgDn / PgUp     |

- **Transform**

  | Action                        | Key       |
  | ----------------------------- | --------- |
  | Flip horizontal / vertical    | ⇧H / ⇧V   |
  | Reset image size              | ⇧R        |
  | Add auto layout               | ⇧A        |
  | Remove auto layout            | ⌥⇧A       |
  | Resize to fill                | ⌘⇧⌥F      |
  | Resize to fit                 | ⌘⇧⌥R      |
  | Frame selection               | ⌘G or ⌘⌥G |
  | Unframe selection             | ⌘⇧G or ⌘⌫ |
  | Send backward / Bring forward | ⌘[ / ⌘]   |
  | Send to back / Bring to front | ⌥⌘[ / ⌥⌘] |

- **Shape**

  | Action               | Key |
  | -------------------- | --- |
  | Remove fill          | ⌥/  |
  | Remove border        | ⇧/  |
  | Swap fill and border | ⇧X  |

- **Alignment**

  | Action                                   | Key          |
  | ---------------------------------------- | ------------ |
  | Align left / right                       | ⌥A / ⌥D      |
  | Align horizontal center                  | ⌥H or ⌥C     |
  | Align top / vertical middle / bottom     | ⌥W / ⌥V / ⌥S |
  | Distribute horizontal / vertical spacing | ⌃⌥H / ⌃⌥V    |
  | Tidy up                                  | ⌃⌥T          |

- **Movement**

  | Action   | Key        |
  | -------- | ---------- |
  | Nudge    | arrow keys |
  | Nudge 10 | ⇧+arrow    |

  Nudge amounts are a user preference.

- **Text**

  | Action                                     | Key                   |
  | ------------------------------------------ | --------------------- |
  | Bold / Italic / Underline                  | ⌘B / ⌘I / ⌘U          |
  | Strikethrough                              | ⌘⇧X                   |
  | Align text left / center / right / justify | ⌘⌥L / ⌘⌥T / ⌘⌥R / ⌘⌥J |

- **Commands available but unbound:**
  - Select similar
  - Group text
  - Use as mask, Remove mask, Detach mask as shape
  - Add grid
  - Paste here
  - Copy as PNG
  - Copy link to selection
  - Set as file thumbnail
  - Show/hide label (the artboard name)
  - Page background show/hide/color

  ⌘K opens a command palette that lists every command by section: Application, Edit, Selection, Tools, View, Transform, Shape, Alignment, Pages, Chat.

### 2.3 Selection

- **[O] Selection behavior is a preference.**
  - _Classic_: a click selects the outermost frame under the cursor.
  - _Deep_: a click selects the innermost frame under the cursor.
  - In both modes, double-click drills one level deeper. Drill state is kept as a set of "drilled-into" ids and is reset when you deselect.
- **[O]** Marquee selection honors modifiers (shift adds; primary and alt are tracked).
- **[O]** Hit testing uses a node bounds tree. It provides `getNodeStackAtPoint` and `getSelectionPathAtPoint`.
- **[O]** Remote users' selections are rendered on the canvas.

### 2.4 Transform

- **[O]** Four corner handles. Below the selection is a purple size badge such as `560 x 450` or `240.7 Hug x 38.5 Hug`; it shows the sizing mode. The name label sits above the frame, and a "+" (add to chat) chip sits at the top-right.
- **[O]** Resize modifiers:
  - Shift locks the aspect ratio.
  - Alt resizes from the center (except while drawing).
  - A snap-disable modifier exists.
  - "Scale" mode (the K tool) scales content, including font sizes, rather than just resizing the box.
  - Resize respects child constraints and can be told to ignore them.
- **[O]** Rotation: `rotateBy` and `setRotation`. The value is normalized to (−180, 180]. **[I]** It is applied around the center from a rotate zone just outside the corners.
- **[O]** Drag-move:
  - Moves into and out of flex/grid parents, with a drop-target indicator.
  - Alt-drag duplicates and shows distances for the duplicate.
  - Holding Shift peeks behind backgrounds.
  - Flex children can be reordered within their stack (`moveInStack`).
- **[O]** On-canvas handles can edit layout values: padding, gap and grid tracks (`layoutHandleStart/Move/End`, `editGridTrack`).

### 2.5 Snapping and measurement

- **[O] Alignment lines** snap to the edges and centers of siblings and parent. Their output is lines plus a snap offset.
- **[O] Equal-spacing guides**: when the moving node can sit at the same gap as neighboring pairs, a spacing guide shows that gap and snaps to it.
- **[O] Distance readouts:**
  - Parent-to-child: dashed lines from the node to its parent's edges. These are visible in screenshot 25.
  - Node-to-node. **[I]** Shown on Alt-hover.
  - Duplicate-drag distances.
- **[O]** There are no rulers and no pixel grid.

### 2.6 Camera

- **[O]** The canvas is infinite. Top-level frames act as artboards and show a name label above them.
- **[O]** Zoom stops: 5, 10, 25, 50, 100, 200, 400, 800, 1600, 3200, 6400, 12800 and 20000%. Zoom in and out step to the nearest stop.
- **[O]** Wheel zoom is smooth and exponential, factor `1.002^(−deltaY·k)`, with k = 1 for large deltas and 8 for small ones (trackpad pinch). It zooms around the cursor.
- **[O]** Zoom transitions animate on the ticker.
- **[O]** Other camera commands: zoom-to-fit, zoom-to-selection with padding, zoom to next/previous frame, and bring bounds into view.
- **[O]** Viewport position and zoom are persisted per page.

### 2.7 Clipboard

- **[O] Copy formats:**
  - Internal nodes
  - Copy as code (Tailwind)
  - Copy as PNG
  - Copy styles and paste styles, including individual style entries
  - Copy link to selection
- **[O] Paste modes:**
  - Normal paste
  - Paste here (at the cursor)
  - Paste to replace
  - Paste over selection
- **[O]** Figma clipboard paste is supported ("Pasted from Figma").
- **[O]** Image paste and drop upload the image and create an image node or fill.

### 2.8 Context menu [I]

- Built from the same command registry, with Arrange, Layout and Copy-as submenus.
- Items: show/hide, lock/unlock, mask, frame/unframe, and add-to-chat.

## 3. Inspector (right panel) [O, screenshots 22/25/43/56 plus bundle headings]

The panel opens with a collapsible "Variables" section (count, search, add) and then "Properties". Section order:

1. **Position**
   - Align row (L, C, R / T, M, B), Rotate 90°, Flip H, Flip V
   - X, Y, rotation°
   - Horizontal and vertical constraint dropdowns (Left/Top) and a constraint widget
   - Z (z-index, default Auto)
   - Expand icon to toggle absolute positioning
2. **Layout**
   - Display segmented control: free/absolute, flex, block, grid
   - W and H, each with a unit/mode dropdown: px, %, Hug, Fill, Auto, Calculate. The dropdown also has "Add min/max width/height".
   - Aspect lock
   - Flex: direction, align, justify, gap. Grid: columns, rows and gaps, plus a "Grid child" section.
   - Padding and Margin, per axis or per side
3. **Appearance**
   - Visibility eye and blend-mode drop
   - Opacity %
   - Corner radius, with a per-corner expand
   - Clip content checkbox
4. **Typography** (text only)
   - Font family picker (all fonts, custom upload)
   - Weight
   - Size px
   - Line height (Auto/px)
   - Letter spacing
   - Horizontal alignment (L, C, R, Justify) and vertical alignment (top, middle, bottom)
   - Settings icon for advanced options
5. **Text Fill** (text only): a fill stack.
6. **Background Fill**: fill stack rows with swatch, hex, opacity %, eye and remove, plus a shader button and "+". A shader paint expands to a preset name with its key props (for example, Gradient Shadow and Gradient Highlight colors).
7. **Border**: per-side widths.
8. **Outline**
9. **Shadow**: box, inner, drop, text.
10. **Filters**
11. **Mask**
12. **Export**: format PNG, JPEG, WebP, SVG, PDF or Tailwind code; scale 0.5x, 1x, 2x, 3x or 4x; filename prefix.

Other contextual sections: Icon, Page (background), Scale (K tool), Colors (editable colors in SVG content).

**Color picker:**

- Paint type tabs: solid, gradient, image
- Custom/Variables tabs
- Saturation-value field, hue strip, alpha strip
- Format select: HEX, RGB, HSL, HSV, LCH, OKLCH, OKLAB, Linear RGB
- Eyedropper and copy buttons
- Numeric channels and an alpha % field

**Shader picker** ("Choose shader"):

- Tabs: Background, SVG, Image
- Search field
- A thumbnail grid from a large preset library
- Parameters grouped (Colors, Effect, etc.) and typed as range, color, select, checkbox, position or gradient-stops

## 4. Rendering approach

- **[O]** The canvas renders with **PixiJS v8**, which prefers WebGL; WebGPU and Canvas2D renderer chunks are also shipped. The scene graph uses one container per node, and hit testing uses the bounds tree.
- **[I]** Text and SVG are rasterized into textures, and the custom caret and text editing (`text-caret` chunk) are drawn on top.
- **[O]** Shaders come from a large node-based shader-component library: around 200 effect components such as MeshGradient, Glass, Halftone and Liquify. They are rendered in a worker (`shader-worker`, `shader-gpu`) and support animation and cursor interaction.
- **[O]** Interaction chrome (selection, alignment lines, distance labels) is drawn in the Pixi scene. The inspector and menus are Svelte DOM.
- **[O]** The model maps 1:1 to HTML and CSS:
  - Import ("recast") turns DOM elements into nodes: `img` becomes image, `svg` becomes svg, a leaf with text becomes text, and anything else becomes a frame. Shader elements are recognized by a data attribute.
  - Export produces Tailwind code.
- **[O]** No CodeMirror was found in any cached canvas chunk. **[I]** It is either lazy-loaded for the `{ }` code panel or used outside the canvas. **[U]** What exactly the code view shows.
- **[O]** Live previews (running dev servers or published builds) are first-class canvas nodes. They support inspect, edit-text, move-element and copy-as-CSS. These are out of scope for this canvas spec.

---

## 5. Verynize today (web/app.js, wonder-shell.js, shaders.js)

**Model**

- Flat `nodes[]` per page, with `parentId`.
- Types: `rectangle`, `text`, `frame`, `image`, `shader`.
- Fixed numeric `x/y/w/h`.
- Single `color` plus a CSS `gradient` string, uniform `radius`, and a single `strokeWidth/strokeColor`.
- `shadow` is a CSS string.
- `layout` is free/flex/grid/block/inline, with uniform `padding` and `gap`.
- `textRuns`; `tokens` are color-only.
- Persisted to localStorage and JSON (`validate` in app.js).

**Rendering**

- DOM. Each node is an absolutely positioned div (`layerElement`).
- The artboard is **fixed at 1000×700**. Zoom is a CSS scale clamped to 25–300% (`setZoom`).

**Interaction**

- No tool modes: toolbar buttons insert nodes at fixed offsets (`add`).
- Click and shift-click selection, with a classic/deep preference applied on click.
- Drag-move and four-corner resize with rotation awareness (`canvas.onpointerdown`).
- `snap()` to sibling edges or a 4px grid, with no visual guides.
- Alt-hover gives a textual Δ readout.
- Space or middle-mouse pan.
- Shortcuts: ⌘Z, ⌘⇧Z, ⌘D, Delete, and arrow nudge only.
- No marquee, clipboard, grouping/framing, context menu, flip, or z-order shortcuts.

**Inspector**

- Generic form plus `installPrecisionControls`:
  - rotation, opacity, clip, border, shadow string, line height and letter spacing
  - align/distribute buttons
  - export: PNG, JPG, WebP, SVG via foreignObject, HTML; 1–3×
- HSV color dialog, a 6-preset shader gallery, and a size badge with name label (`updateMeasurement`).

## 6. Canvas parity gaps (prioritized by user-visible impact)

| #   | Feature                                            | Wonder behavior                                                                                                                                                                        | Verynize status                                                                                          | Effort | Recommended change                                                                                                                                                                                                                                                                                                       |
| --- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Infinite canvas and camera                         | Unbounded world with top-level frames as artboards; zoom 5%–20000% on fixed stops; cursor-anchored smooth wheel/pinch zoom; ⇧0/⇧1/⇧2, N/⇧N **[O]**                                     | Fixed 1000×700 board; 25–300% CSS scale; scroll-based pan; ctrl-wheel zoom not cursor-anchored           | L      | Replace `setZoom`/`fitCanvas` with a camera `{x,y,scale}` applied as a `translate+scale` transform on `#canvas`. Drop the 1000×700 assumptions in `setZoom`, `exportArtwork` and `exportHTML` (export per top-level frame instead). Add a `zoomStops` table and a `screenToWorld` helper.                                |
| 2   | Tool modes and draw-to-create                      | V/K/H/F/S/T/I tools; drag to draw frames, text and shaders; Frame tool device presets **[O]**                                                                                          | Buttons insert at fixed positions (`add`)                                                                | M      | Add `activeTool` state to the wonder-shell.js toolbar. On canvas pointerdown in a draw tool, rubber-band a rect and then `add(type,{x,y,w,h})`, parenting to the frame under the cursor. Add a preset list to the frame tool (§2.1).                                                                                     |
| 3   | Marquee selection                                  | Drag on empty canvas selects intersecting nodes; Shift adds **[O]**                                                                                                                    | Missing; an empty click clears                                                                           | S      | In `canvas.onpointerdown`'s empty branch, draw an overlay rect and select nodes whose `getBoundingClientRect` intersects it. Restrict to the current drill scope.                                                                                                                                                        |
| 4   | Smart guides and spacing snapping                  | Visible alignment lines (edges and centers vs siblings and parent), equal-gap guides, parent-distance dashes, Alt node-to-node distances **[O]**                                       | `snap()` is silent, edge-only and sibling-only, with no center or equal-gap support; Alt shows text only | M      | Extend `snap()` to return `{value, guides}` including centers and the parent box. Render guides in an overlay layer inside `#canvas-wrap`. Add an equal-gap search over sibling pairs. Draw red distance lines with labels on Alt-hover instead of the footer badge.                                                     |
| 5   | Keyboard map                                       | ~90 bindings (§2.2) **[O]**                                                                                                                                                            | 5 bindings                                                                                               | S–M    | Add a command registry `{id,label,keys,run}` in app.js. Drive both the keydown handler and a ⌘K palette from it. Cover clipboard, z-order (⌘[ ]), ⌘G/⌘⇧G, alignment ⌥keys, ⇧H/⇧V flip, ⇧0/1/2 zoom, Tab cycling, ↵/⇧↵ child/parent, ⌘⇧H/⌘⇧L, and 0–9 opacity.                                                            |
| 6   | Clipboard                                          | Copy/cut/paste nodes, paste here/replace/over, copy/paste styles, copy as code/PNG **[O]**                                                                                             | None (duplicate only)                                                                                    | M      | Serialize the selection plus descendants (reuse `#duplicate` remapping) to `navigator.clipboard` as `text/html`, with a JSON metadata script like `exportHTML`. Paste through `importHTML`. Add a style-only copy that reads the style keys of `defaults`.                                                               |
| 7   | Sizing modes (Hug/Fill/%/Auto) and min/max         | Per-axis W/H mode dropdown, constrained by context; badge shows "Hug" **[O]**                                                                                                          | Numeric w/h only; flow children are fixed size                                                           | M      | Add `wMode`/`hMode` (`fixed\|hug\|fill\|percent\|auto`) and `minW/maxW/minH/maxH` to `defaults` and `validate`. Map them in `layerElement` to CSS (`fit-content`, `flex:1`/`align-self:stretch`, `%`). Show the mode in the `updateMeasurement` badge.                                                                   |
| 8   | Frame selection / unframe (grouping)               | ⌘G wraps the selection in a frame sized to its bounds; ⌘⇧G unwraps; "Add auto layout" ⇧A converts to flex **[O]**                                                                      | Missing                                                                                                  | S      | Add `frameSelection()`: create a frame at the union bounds and reparent with relative coordinates. `unframe` reverses it. `addAutoLayout` sets `layout:'flex'` and infers direction and gap from the children's positions.                                                                                               |
| 9   | Deep select and drill-in                           | Click picks outermost (classic) or innermost (deep); double-click drills one level; ↵/⇧↵/Tab navigation **[O]**                                                                        | Classic climbs to the root; double-click only focuses the text field; no drill state                     | S      | Keep a `drill` set. In pointerdown, resolve the hit to the first ancestor that is not drilled. Double-click adds to the drill set, or edits text inline when on a text node. Clear on Esc or empty click.                                                                                                                |
| 10  | Fill stacks and paint types                        | Multiple fills per node (solid, gradient, image, shader), each with opacity and visibility; separate Text Fill; Border, Outline, Shadow and Filters as lists **[O]**                   | One color plus a gradient string; one border; a free-text shadow string                                  | L      | Migrate to `fills:[{type,color,opacity,visible,...}]`, `strokes:[]`, `effects:[{type:'shadow'\|'inner'\|'blur'\|...}]` with a document version bump in `validate`. Compose CSS backgrounds in `layerElement`. Build list editors in `installPrecisionControls` matching screenshot 22 (row: swatch, hex, %, eye, minus). |
| 11  | Per-corner radius, per-side padding/border, margin | Corner expand; per-side padding, margin and border widths **[O]**                                                                                                                      | Uniform radius, padding and border                                                                       | S      | Accept a number or a 4-tuple for `radius`, `padding` and `strokeWidth`; add `margin`. Add the expand toggles in the inspector.                                                                                                                                                                                           |
| 12  | Blend modes and filters                            | 18 blend modes; filter stack (blur, brightness, contrast, grayscale, hue, invert, saturate, sepia, drop shadow); background blend **[O]**                                              | Missing                                                                                                  | S      | Add `blendMode` and `filters[]` to the model. Map to `mix-blend-mode` and `filter` in `layerElement`. Add the dropdown under the Appearance drop icon.                                                                                                                                                                   |
| 13  | Flip, rotate 90° and Scale tool                    | ⇧H/⇧V flips via negative scale; rotate button; K tool scales content proportionally **[O]**                                                                                            | Rotation field only; ×0.5/×2 buttons (`#scale-up/down`)                                                  | S      | Add `flipX/flipY` (CSS `scale(-1,1)`). Turn the scale buttons into a K-tool drag mode that reuses the existing proportional math.                                                                                                                                                                                        |
| 14  | Inspector layout parity                            | Position (align row, X, Y, °, constraints, Z), Layout (display segmented control, W/H modes, padding, margin), Appearance, Typography, fill sections and Export, in that order **[O]** | Generic labeled form; parent picker; Align as an 8-button grid                                           | M      | Restructure in wonder-shell.js: move the align buttons into an icon row under Position; replace the `layout` select with a 4-icon segmented control; add the Left/Top constraint selects (new `constraints:{h,v}` field applied when the parent resizes).                                                                |
| 15  | Constraints                                        | Left, right, left+right, center, scale horizontally and vertically, applied when the parent resizes **[I]**                                                                            | None; children keep absolute x/y                                                                         | M      | Add `constraints` and apply it in the resize branch of `canvas.onpointerdown` for descendants of the resized frame.                                                                                                                                                                                                      |
| 16  | Context menu                                       | Right-click menu from the command registry (Arrange, Layout, Copy as, show/hide, lock, mask, frame) **[I]**                                                                            | None                                                                                                     | S      | Build on the registry from #5.                                                                                                                                                                                                                                                                                           |
| 17  | Lock and hide                                      | `isLocked` and `isVisible` per node, with toggles in layer rows and ⌘⇧L/⌘⇧H **[O]**                                                                                                    | Missing                                                                                                  | S      | Add the fields. Skip locked nodes in hit-testing and hidden nodes in `layerElement` (keep them in layers with dimmed rows). Add eye and lock icons in `render()` rows.                                                                                                                                                   |
| 18  | Layers panel drag-reorder and rename               | Drag to reorder or reparent, inline rename (⌘R/F2), collapse, find (⌘F) **[O]**                                                                                                        | Click and shift-select only; reparent through the inspector select                                       | M      | Make rows draggable (before/after/inside zones). Rename with a double-click input. Add collapse state.                                                                                                                                                                                                                   |
| 19  | Color picker fidelity                              | Solid/gradient/image tabs, Custom/Variables, alpha strip, format select (HEX/RGB/HSL/HSV/LCH/OKLCH), eyedropper **[O]**                                                                | HSV field, hue slider, hex, opacity bound to node opacity                                                | M      | Store alpha per fill, not node opacity. Add an alpha strip, a format select and `EyeDropper` API support. Add a gradient-stop editor once #10 lands.                                                                                                                                                                     |
| 20  | Shader library                                     | Large component-based preset library with Background/SVG/Image tabs, search and typed params **[O]**                                                                                   | 6 independently authored WebGL presets (shaders.js)                                                      | L      | Keep it independent. Add more original presets and expose params through a typed schema (`range\|color\|select`) in shaders.js. Make the shader a paint inside the fill stack (#10) as well as a node type.                                                                                                              |
| 21  | Ellipse, SVG node and icons                        | No dedicated ellipse primitive: shapes and icons are `svg` nodes with editable colors; an icon library panel **[O]**                                                                   | Rectangle node; 4 icons embedded as data-URL images                                                      | S–M    | Add an `svg` node type with sanitized inline markup (reuse the trace-bitmap/generation sanitizer). Add a "Colors" inspector section that lists fill colors found in the SVG.                                                                                                                                             |
| 22  | Export options                                     | PNG, JPEG, WebP, SVG, PDF, Tailwind code; 0.5x–4x; filename prefix **[O]**                                                                                                             | PNG/JPG/WebP/SVG(foreignObject)/HTML; 1–3×                                                               | S      | Widen the scale range in `exportArtwork`. Add PDF (native print path already exists) and a Tailwind/HTML code option. Add a filename prefix field.                                                                                                                                                                       |
| 23  | Collaboration granularity                          | Yjs per-node records, live remote selections and cursors **[O]**                                                                                                                       | Snapshot rooms with conflict choice (cloud-panel.js)                                                     | L      | Out of canvas scope. Consider moving to per-node CRDT records keyed like `pageNodes`.                                                                                                                                                                                                                                    |

Not in Wonder either, so not gaps: rulers, pixel grid, pen/vector path editing, boolean ops, components/instances.

### Suggested sequencing

1. Camera and infinite canvas (#1). Most other interactions depend on world coordinates.
2. Command registry and shortcuts (#5), which also unblocks #16.
3. Tools, marquee, drill and framing (#2, #3, #8, #9).
4. Guides (#4) and sizing modes (#7).
5. Paint model migration (#10–#12), then inspector restructure (#14) and the color picker (#19).
