# Canvas parity audit: Verynize side (2026-10-31)

Checklist: `../CHECKLIST.md`. Harness: `capture.cjs` (Playwright `_electron`, 1440×870 content, `--force-device-scale-factor=2`, `--force-color-profile=srgb`, temp `--user-data-dir`, `VERYNIZE_SKIP_ONBOARDING=1`). Built from `npm run build:ui` at `11cd5fa` (branch `docs/canvas-audit`). DOM measurements for every shot are in `metrics.json` (open menus with every item, separator, shortcut, disabled flag and rect; tooltips; selection badge and name label; hover outline; guides and their labels; drop target; spacing bands; camera; tool; the cursor under the pointer; the full node list).

```sh
npm run build:ui
node design/wonder/canvas-audit/verynize/capture.cjs              # everything (≈4 min)
node design/wonder/canvas-audit/verynize/capture.cjs CM2 TR8       # only files starting with these prefixes
node design/wonder/canvas-audit/verynize/capture.cjs --new-only   # keep existing PNGs
python3 design/wonder/canvas-audit/make-pairs.py                  # pairs/<name>.png (Wonder | magenta 20px | Verynize)
```

**Fixture** (one document, reloaded before every step; camera = zoom to fit, 36%). Page 1 holds:

- the artboard `Portfolio Home Desktop`, a 1440×900 free frame that clips its content. Its children are:
  - `Site Header`, a frame containing the text `Logo`;
  - `Hero Section`, a flex row with gap 40 and padding 40, holding `Hero Text` (text, H Hug), `Hero Media` (image, 280×280) and `Accent Card` (rectangle, W Fill);
  - `Ambient Glow Backdrop` (shader);
  - `About` (text);
  - `Chip A`, `Chip B` and `Chip C` (rectangles: A–B gap 40, B–C gap 120);
  - `Hidden note` (hidden text) and `Locked badge` (locked rectangle).
- a second artboard `MacBook Air` (640×416) containing the text `Halooo`.

Page 2 holds one rectangle.

**Wonder evidence used.**

- The user's two screenshots:
  - `…77784354….png`: right-click on a frame, at 1×.
  - `…28e4e270….png`: right-click on empty canvas, at 1×.
- Codex's files in `../wonder/`. There was no `notes.md` there when this pass finished, so I read only the PNGs, `manifest.json` and file names.
- `design/wonder/*.png`.

Wonder measurements below come from the user screenshots, which are 1× captures. They are therefore ±1 px.

**Caveat on the Wonder files.** `manifest.json` shows that several Wonder PNGs are byte-identical, so their pairs do not show the named state:

- `CM2-frame.png` = `S4-frame.png` = `T1-plus/shader/text/view-a/view-b.png`. All of these are an empty page with the Frame tool active.
- `S2-click` = `S2-drill` = `S2-escape` = `T1-move-tooltip`.
- `TR2-hover` = `TR2-rotate`.
- `TR3-nudge` = `S4-frame-ready`.

For CM2, compare against the user screenshot and `../wonder/CM2-copy-as.png` / `CM2-arrange.png` / `CM2-layout.png` / `CM2-select-layer.png`. Those do show the menu.

**State names** follow Codex's Wonder names wherever one existed, so `make-pairs.py` pairs them (81 pairs). Verynize-only extra states:

- `CM4-image`, `CM4-rectangle`;
- `S1-hover-nested`, `S1-hover-deep-cmd`, `S2-click-deep-cmd`, `S2-empty-click`, `S3-shift-remove`, `S3-marquee-result`, `S3-marquee-inside-frame/-result`;
- `S4-hug/fill/fixed/multi-selection`;
- `T1-eyedropper`, `T1-ellipse`, `T4-*-after`, `T4-text-click`;
- `TR1-edge-hover`, `TR5-alt-sibling`, `TR6-alt-drag-result`, `TR7-drag-into-flex(-result)`;
- `V1-pinch-at-cursor`, `V1-shift1-fit`, `V1-shift2-selection`, `V2-space-hold`, `V2-space-drag`;
- `K1-command-palette`, `K3-hide/lock/delete`;
- `TX1-escape`, `TX1-drag-result`;
- `L1-expand-collapse`, `L2-page-delete`.

Two name matches are guesses:

- `TR4-guide` is my equal-spacing shot.
- `TR4-sibling` is my edge-alignment shot.

Common style of the canvas context menu (`#canvas-menu`, `web/canvas.css:64-69`; built in `web/canvas-interactions.js:1499-1519`):

|                   | Verynize (measured)                                | Wonder (user screenshots)                      |
| ----------------- | -------------------------------------------------- | ---------------------------------------------- |
| Menu width        | 210 (min-width), content-sized                     | 176–177                                        |
| Background        | `#262626` rgb(38,38,38)                            | rgb(28,28,28)                                  |
| Border            | 1px `#3a3a3a` rgb(58,58,58)                        | 1px ≈ rgb(34–38)                               |
| Radius / padding  | 8 / 4                                              | ≈8 / ≈4                                        |
| Item              | 25 tall, padding 6/8, 11px Inter, radius 5         | 25 tall, ≈13px                                 |
| Separator         | `<hr>` 1px `#383838`, 4px margin → 9px block       | 1px ≈ rgb(40,40,40), ≈10px block               |
| Highlighted row   | solid accent `#b93cdb` rgb(185,60,219), white text | tinted purple rgb(69,41,85), text keeps colour |
| Shortcut text     | `#8a8a8a`, uppercase (`DELETE`)                    | muted, glyphs (`⌘⇧H`)                          |
| Submenus          | none (flat list)                                   | `›` chevrons, side flyouts                     |
| Initial highlight | none                                               | first item (`Add context`) highlighted         |

Verynize's two Radix menus (layers row and pages row) use the shadcn context-menu instead (`web/src/components/ui/context-menu.tsx`): width 176, bg rgb(34,34,34), border rgb(46,46,46), radius 10, padding 6, items 28 tall at 12px, with icons. That gives two different menu styles on the same screen.

---

## CM. Context menus

### CM1 Empty canvas (`CM1-empty.png`)

- **Steps.** Fresh launch with nothing copied, nothing selected; right-click empty canvas.
- **Verynize now.** The menu is 210×119 at the cursor. Items: `Select all ⌘A` · `Select inverse ⌘⇧A` | `Zoom to fit ⇧1` · `Zoom to selection ⇧2`.
  - Paste is filtered out entirely because the clipboard is empty.
  - Commands whose `when()` fails are omitted, not disabled.
- **Source.** `web/canvas-interactions.js:1499-1519` (groups at `:1504`, filter at `:1506`). Command labels and keys are in `:1393-1457`.
- **Wonder.** 176×128. Items: `Select all ⌘A` | `Paste here` | `Hide left sidebar` · `Hide right sidebar`.
- **Difference.**
  - Verynize lacks `Paste here` and the two sidebar toggles.
  - It adds `Select inverse` and the two zoom items.
  - Its menu is 34 px wider and has a different background and hover.
- **Fix sketch.**
  - Give the context menu its own per-target item lists instead of reusing the generic groups.
  - Empty-canvas list: `select.all` | `edit.pasteHere` | `view.toggleLeft`, `view.toggleRight`.
  - Add a `pasteHere` command that pastes at `screenToWorld(contextmenu point)`.
  - The sidebar toggles flip `body.left-collapsed` / `right-collapsed` (the cross-island contract). Label them `Show …` when collapsed.
- **Verdict:** mismatch. Wrong items, extra items, wrong size and colours.

### CM2 A frame (`CM2-frame.png`, `CM2-copy-as.png`, `CM2-select-layer.png`, `CM2-arrange.png`, `CM2-layout.png`)

- **Steps.** Right-click the artboard background. The artboard is selected and the menu opens.
- **Verynize now.** One flat menu, 210×773 (36 items), clamped to `innerHeight − h − 8`:
  - `Copy ⌘C` · `Cut ⌘X` · `Duplicate ⌘D` · `Delete DELETE`
  - `Copy as PNG` · `Copy as code ⌘⇧C` · `Copy style ⌘⌥C` · `Paste style ⌘⌥V`
  - `Select all ⌘A` · `Select inverse ⌘⇧A` · `Select all matching layers ⌘⌥A`
  - `Bring to front ⌘⌥]` · `Bring forward ⌘]` · `Send backward ⌘[` · `Send to back ⌘⌥[`
  - `Flip horizontal ⇧H` · `Flip vertical ⇧V` · `Rotate 90° right ⌥⇧R` · `Scale ½×` · `Scale 2×`
  - `Frame selection ⌘G` · `Unframe selection ⌘⇧G` · `Add auto layout ⇧A` · `Remove auto layout ⌥⇧A`
  - `Show/hide ⌘⇧H` · `Lock/unlock ⌘⇧L`
  - `Zoom to fit ⇧1` · `Zoom to selection ⇧2`

  Further details:
  - Paste appears only after a copy (CM10).
  - There are no submenus, so the four submenu shots hover the nearest flat item instead: `Copy as PNG`, `Select all matching layers`, `Bring to front`, `Add auto layout`.
  - **Bug seen in the shot:** the selection size badge (`#selection-measure`, `1440 × 900`) paints _over_ the menu (`Scale 2×` row).
  - The menu inherits no item for `Add context`, `Copy link to selection`, `Select layer ›`, `Paste to replace`, `Paste over selection`, `Hide label` or `Set as file thumbnail`.

- **Source.**
  - `web/canvas-interactions.js:1504`: groups.
  - `:1468`: `shortcutText` uppercases the whole key, hence `DELETE`.
  - `web/canvas.css:64-69`: style.
  - `web/wonder-shell.css:6`: `#selection-measure{…z-index:20}`, which sits above the body-level menu because of the stacking context.
- **Wonder** (user screenshot plus Codex submenu shots). 177×420:
  - `Add context ⌘L`
  - `Copy ⌘C` · `Copy as ›` · `Copy link to selection`
  - `Select layer ›` · `Paste ⌘V` · `Paste to replace ⌘⇧R` · `Paste over selection ⌘⇧V` · `Duplicate ⌘D`
  - `Hide ⌘⇧H` · `Lock ⌘⇧L` (· `Hide label` on artboards, seen in Codex's CM2/CM6 shots)
  - `Arrange ›`
  - `Layout ›`
  - `Set as file thumbnail`

  Submenu contents:
  - `Copy as ›`: `Copy as code ⌘⇧C`, `Copy as PNG`, `Copy prompt ⌘⇧⌥C`, `Copy styles ⌘⌥C`.
  - `Arrange ›`: `Bring to front ⌥⌘]`, `Bring forward ⌘]`, `Send backward ⌘[`, `Send to back ⌥⌘[` | `Flip horizontal ⇧H`, `Flip vertical ⇧V`.
  - `Layout ›`: `Frame selection ⌘G`, `Add auto layout ⇧A`.
  - `Select layer ›`: the layer stack under the pointer (e.g. `Frame`).

  Wonder has no Cut, Delete, Select inverse, flip/rotate/scale, unframe or zoom items in this menu.

- **Fix sketch.**
  - Add submenu support to the canvas menu, or move it to the Radix `ContextMenu` in the chrome island with a portal, which also fixes the z-order.
  - Selection menu: `Add context` (send the selection to chat) | `Copy`, `Copy as ›`, `Copy link to selection` | `Select layer ›` (from `document.elementsFromPoint` → node path) and the paste family (`Paste`, `Paste to replace`, `Paste over selection`, `Duplicate`) | `Hide`/`Show`, `Lock`/`Unlock`, `Hide label` (artboards only) | `Arrange ›` (4 z-order items | 2 flips) | `Layout ›` (`Frame selection`, `Add auto layout`/`Remove auto layout`) | `Set as file thumbnail`.
  - Drop Cut, Delete, inverse, matching, rotate and scale from the menu; keep them as commands.
  - Render keys with ⌫ and the glyph order ⌘⇧ / ⌥⌘ used by Wonder.
  - Restyle to 176 px wide, rgb(28,28,28), 13px, tinted hover, first item pre-highlighted.
- **Verdict:** mismatch. Flat 36-item list versus Wonder's 14 items with 4 submenus. Most labels and the order differ. The badge overlaps the menu.

### CM3 A text layer (`CM3-text.png`)

- **Verynize now.** Right-clicking `About` selects it. The menu is identical to CM2 (same 36 items; nothing is text-specific).
- **Source.** `web/canvas-interactions.js:1499-1519`.
- **Wonder.** `CM3-text` / `CM3-text-menu` show the same structure as CM2 (Add context … Set as file thumbnail).
- **Fix.** Same as CM2. No text-specific items are needed.
- **Verdict:** mismatch, for the same reasons as CM2.

### CM4 Non-frame child (`CM4-rectangle.png`, `CM4-image.png`, `CM4-shader.png`)

- **Verynize now.** Same 36-item menu for the rectangle, image and shader.
  - Behaviour difference: with `Hero Section` already selected, right-clicking `Hero Media` keeps `Hero Section` selected. The handler uses `resolveHit()`, not `clickTarget()`, so the menu does not retarget to the child. A left click would drill into it.
- **Source.** `web/canvas-interactions.js:1501-1502`.
- **Wonder.** `CM4-shader` shows the CM2 structure, without `Hide label`, for a child shader.
- **Fix.** Same item list as CM2. In the handler, select `clickTarget(hit)` when the hit is a descendant of the current selection.
- **Verdict:** mismatch. Items as CM2, and right-click does not drill into a selected parent's child.

### CM5 Multi-selection (`CM5-multi.png`)

- **Verynize now.** With Chip A, Chip B and About selected, right-clicking Chip B keeps all three. The menu is the same 36 items.
  - The badge shows only one node (`400 × 56`, name label `About`). There is no union box (see S4).
- **Source.** `web/canvas-interactions.js:1502`; `web/app.js:98` (`updateMeasurement` uses `chosen()`, the first selected node).
- **Wonder.** `CM5-multi` shows the same structure as CM2.
- **Fix.** As CM2.
- **Verdict:** mismatch, as CM2.

### CM6 Hidden and locked (`CM6-hidden.png`, `CM6-locked.png`)

- **Verynize now.**
  - **Hidden layer:** it has no canvas box, so it was selected from the layers panel and the empty canvas right-clicked. The full menu shows the static label `Show/hide ⌘⇧H`.
  - **Locked layer:** right-clicking `Locked badge` selects the artboard, not the locked layer, because locked layers are not hit. The menu shows `Lock/unlock ⌘⇧L`.
  - Labels never switch to Show / Unlock.
- **Source.** `web/canvas-interactions.js:1446-1447` (static labels), `:1141` (`toggleFlag`).
- **Wonder.** `CM6-hidden` (from a layers row) shows `Show ⌘⇧H`. `CM6-locked` shows `Unlock ⌘⇧L`. Labels follow the state.
- **Fix.** Give commands a `label()` function: `Hide`/`Show` when every selected node is hidden, `Lock`/`Unlock` likewise. Use it in the menu and the palette.
- **Verdict:** mismatch. Static combined labels.

### CM7 Layers panel row (`CM7-row.png`)

- **Verynize now.** Radix context menu, 176×107: `Rename` (pencil icon) | `Lock` · `Hide`. Rows are 28 tall, 12px, with icons and no shortcuts.
- **Source.** `web/src/islands/sidebar/LayersSection.tsx:249-263`.
- **Wonder.** `CM7-row` shows the **same full canvas menu** as CM2: Add context ⌘L … Set as file thumbnail.
- **Fix.** Share one menu model (from the command registry) between canvas and layer rows. Right-click on a row selects that row's node first, then renders the canvas menu. Keep rename on double-click and F2.
- **Verdict:** mismatch. Different menu entirely.

### CM8 Pages panel row (`CM8-page.png`)

- **Verynize now.** 176×70: `Rename page` (pencil) · `Delete page` (trash, destructive red; disabled when only one page).
- **Source.** `web/src/islands/sidebar/PagesSection.tsx:44-57`.
- **Wonder.** `Rename F2` · `Delete` (red, dimmed when there is one page).
- **Fix.** Labels become `Rename` and `Delete`; add an `F2` shortcut hint; drop the icons; use the shared menu style.
- **Verdict:** close. Same two actions, but different labels, icons and missing shortcut.

### CM9 Frame name label (`CM9-label.png`)

- **Verynize now.** Right-clicking the artboard label (`#canvas-overlay .frame-label`) does not select the frame. It opens the empty-canvas menu: `Select all ⌘A` · `Select inverse ⌘⇧A` | `Zoom to fit ⇧1` · `Zoom to selection ⇧2`.
- **Source.** `web/canvas-interactions.js:1501` (only `#canvas .layer` is hit-tested; labels live in the overlay, `:1038-1047`).
- **Wonder.** `CM9-label` selects the frame and shows the frame menu (CM2).
- **Fix.** In the contextmenu handler, resolve `e.target.closest('.frame-label')?.dataset.id` first and select it.
- **Verdict:** mismatch.

### CM10 Paste disabled state (`CM10-empty-clipboard.png`, `CM10-copied.png`)

- **Verynize now.**
  - Empty clipboard: the Paste item is **absent**, not disabled (CM1 list).
  - After ⌘C on Chip A with Chip A still selected: `Paste ⌘V` appears as the 3rd item (after Copy and Cut) in the 37-item selection menu.
  - No item is ever rendered disabled.
- **Source.** `web/canvas-interactions.js:1506` (`c.id === 'edit.paste' ? !!clipboard : …`).
- **Wonder.** The paste family is listed in both states (`CM10-empty-clipboard` vs `CM10-copied`). I could not confirm a disabled tint from the PNGs. Codex's notes should settle it.
- **Fix.** Always render the paste family and set `aria-disabled` plus a dim style when there is no clipboard.
- **Verdict:** mismatch. Wonder keeps the items; Verynize hides them. The disabled style is unconfirmed.

## T. Toolbar and tools

### T1 Toolbar buttons (`T1-move/scale/hand/frame/shader/text/view-a/view-b/plus.png`; extras `T1-eyedropper`, `T1-ellipse`)

- **Verynize now.** The bottom toolbar is 44 tall, radius 24 (`rounded-3xl`). The tool buttons are 32×32 with radius 12. In order:
  - Move `V` · Scale `K` · Hand `H` · **Eyedropper `I`**
  - | Frame `F` · **Ellipse `O`** · Shader `S` · Text `T`
  - | `Details ⌥1` · `Design ⌥2` · `+` (tooltip `Views`)

  Tooltip: 24 tall, radius 8, rgb(28,28,28), 12px Inter, label plus muted key. For example `Move V` is 67.6×24, placed 8 px above the button.

  Active tool: `bg-accent` (grey) with foreground icon. The active layout toggle uses a purple icon.

- **Source.** `web/src/islands/chrome/CanvasOverlays.tsx:66-75` (TOOLS), `:107-174` (Toolbar), `:193` (`Views`); `web/src/islands/chrome/tip.tsx`.
- **Wonder** (`../wonder/T1-*-tooltip.png`, `design/wonder/20-frame-tool.png`). Move · Scale · Hand | Frame · Shader · Text | view-a · view-b · `+`.
  - Tooltip `Move V`; the `+` tooltip is `Save or choose a view`.
  - No Eyedropper or Ellipse buttons (both are keyboard-only in Wonder: I, and no ellipse tool).
- **Fix.**
  - Remove `eyedropper-tool` and `add-ellipse` from `TOOLS`; keep their commands and keys.
  - Rename the `+` tooltip to `Save or choose a view`.
  - Check the view-a and view-b tooltip strings against Codex's notes. The Wonder PNGs did not show them.
- **Verdict:** mismatch. Two extra tools and a different `+` tooltip. Order, sizes and tooltip format match.

### T2 `+` menu (`T2-plus.png`)

- **Verynize now.** 256×169:
  - Label `Design · edited`
  - `Save current view` · `Reset to Design`
  - |
  - `Details ⌥1` · `Design ⌥2` · `Canvas ⌥0`, each with a pin icon on Details and Design.
- **Source.** `CanvasOverlays.tsx:186-238`.
- **Wonder** (`../wonder/T2-plus.png`, the T1-move sheet): the same `Design · edited`, `Save current view`, `Reset to Design` | `Details ⌥1`, `Design ⌥2`, `Canvas ⌥0` with pins.
- **Fix.** None structural. Compare widths once Codex's notes give a measurement.
- **Verdict:** match (content and order).

### T3 View toggles (`T3-details.png`, `T3-design.png`)

- **Verynize now.**
  - Details (⌥1) collapses the left sidebar into the floating page pill (`Page 1 ⌃` with a show-sidebar button) and keeps the right panel.
  - Design (⌥2) shows both sidebars.
- **Source.** `CanvasOverlays.tsx:145-170`; `web/src/islands/chrome/hooks.ts:68` (`LAYOUTS`).
- **Wonder** (`T3-details`, `T3-design`): same idea. Details hides the left panel and shows the file pill.
- **Fix.** Pixel-compare the pill.
- **Verdict:** match (behaviour).

### T4 Per-tool canvas behaviour (`T4-scale.png`, `T4-scale-after.png`, `T4-shader.png`, `T4-shader-after.png`, `T4-text-click.png`)

- **Verynize now.**
  - **Scale (K).** Dragging a corner scales the box and content uniformly by the _dominant_ factor. On a wide, short layer a small vertical move dominates: dragging `Site Header` (1440×72) by +80/+20 screen px gave **2597.9 × 129.9**, with the logo font 20 → 36.1. The badge shows `2597.9 × 129.9`.
  - **Shader (S).** Drag rubber-bands a rectangle, outline only. On release it creates `Aurora shader` (288×45 here) parented to the frame under the cursor. Click without drag gives a 480×300 default.
  - **Text (T).** Click creates a 240×60 text box named `Text`, content `Your next idea`, system-ui 24px, colour #25252E. That is dark text on a dark artboard. It enters editing with all text selected.
  - The tool returns to Move after each draw.
- **Source.** `web/canvas-interactions.js:915-951` (resize/scale, factor pick at `:927`), `:981-1015` (`startDraw`, default sizes at `:994`), `web/app.js:22` (text default `Your next idea`).
- **Wonder.**
  - `T4-scale`: scale handle drag on a rotated frame.
  - `T4-shader`: shader drawn 120×120 with Pixel Party.
  - `TX1-click`: text starts **empty** with a caret, Inter 12, W/H `Hug` (0 × 14.5), black.
- **Fix.**
  - Scale: use the factor along the drag diagonal (project the pointer onto the corner vector) rather than max-deviation.
  - Text tool click: create an empty `Hug × Hug` text in Inter 12 with the default ink, caret at the start. Delete it if it is still empty on exit.
  - Shader default: match Wonder's preset and size (needs Codex's numbers).
- **Verdict:** mismatch. Text defaults differ, and the scale factor jumps on thin layers.

### T5 `?` button (`T5-help.png`)

- **Verynize now.** The 26 px round `?` at bottom-left (7/7 inset) opens a popover titled `Keyboard shortcuts` (256×528) listing 19 rows:
  - Tools: Move V, Scale K, Hand H / Space, Frame F, Rectangle R, Ellipse O, Text T, Shader S, Eyedropper I
  - Flip horizontal / vertical ⇧H / ⇧V; Rotate 90° ⌥⇧R
  - Zoom in / out ⌘+ / ⌘−; Zoom to fit ⇧1; Zoom to 100% ⇧0
  - Undo / Redo ⌘Z / ⇧⌘Z; Nudge Arrows; Multi-select Shift click
  - Search files ⌘K; Details · Design · Canvas ⌥1 ⌥2 ⌥0
- **Source.** `CanvasOverlays.tsx:321-381`.
- **Wonder** (`T5-help`). A help menu:
  - `Docs ↗` · `Keyboard shortcuts` · `Restart onboarding` · `Give feedback` · `Contact us ↗` · `Discord community ↗` · `Export diagnostic logs`
  - | `What's new`: `Wonder Capture · August 18 ↗`, `Gradients & Presence · August 3 ↗`, `View all ↗`
- **Fix.** Turn `?` into a menu with the equivalent items. `Keyboard shortcuts` opens the K1 panel. Docs, feedback and community items can be hidden until Verynize has targets, but keep the order.
- **Verdict:** mismatch.

### T6 Zoom label (`T6-zoom.png`)

- **Verynize now.** The `36%` button at bottom-right (24 tall) opens a 256×169 menu:
  - `Zoom in ⌘+` · `Zoom out ⌘−` · `Zoom to fit ⇧1` · `Zoom to 100%` (no shortcut shown)
  - | `Snap to objects ✓` · `Saved views…`
- **Source.** `CanvasOverlays.tsx:397-478`; `web/src/islands/chrome/chrome.css:128-136` (pseudo-label for `#zoom-reset`).
- **Wonder** (`T6-zoom`):
  - `Zoom to 50%` · `Zoom to 100% ⇧0` · `Zoom to 200%`
  - | `Zoom in ⌘+` · `Zoom out ⌘−` · `Zoom to fit ⇧1`
- **Fix.** Reorder to Wonder's two groups. Add the 50% and 200% items. Show `⇧0` on 100%. Move `Snap to objects` and `Saved views…` elsewhere (preferences / views menu).
- **Verdict:** mismatch.

## S. Selection

### S1 Hover (`S1-hover.png`, `S1-hover-nested.png`, `S1-hover-deep-cmd.png`)

- **Verynize now.**
  - Hovering inside the artboard with nothing selected outlines the artboard's direct child under the pointer (`Hero Section`, 464×131 screen). The outline is 1.5px accent `#b93cdb`, and its 3 children are drawn 1px dashed.
  - With `Hero Section` selected, hovering `Hero Media` outlines the child (101.6 px square) and shows the hero's spacing bands.
  - Holding ⌘ hovers the innermost layer.
- **Source.** `web/canvas-interactions.js:80-104`; `web/canvas.css:31-32`.
- **Wonder** (`S1-hover`): a thin purple outline on the hovered frame. No dashed children are visible in that shot.
- **Fix.** Confirm Wonder's dashed-child rule from Codex's notes; drop `.hover-child` if Wonder does not draw it.
- **Verdict:** close.

### S2 Click, drill, Esc (`S2-classic.png`, `S2-drill.png`, `S2-double.png`, `S2-escape.png`, `S2-empty-click.png`, `S2-click-deep-cmd.png`)

- **Verynize now.**
  - **Classic click** on `Hero Media` selects `Hero Section`, the artboard's direct child.
  - **A second click** drills into `Hero Media`.
  - **Double-click** also ends on `Hero Media`.
  - **Esc** clears the whole selection rather than going up one level, and clears the drill set.
  - **Empty click** deselects.
  - **⌘-click** in the run selected `Hero Section`, not `Hero Media`. The deep modifier did not apply on a Playwright click with Meta held; recheck by hand.
- **Source.** `web/canvas-interactions.js:445-465` (resolveHit/clickTarget), `:505-536`, `:1425` (`select.escape` → `clearSelection`), `:1258` (`selectParent` exists on ⇧↵ / `\`).
- **Wonder** (`S2-classic`, `S2-double`, `S2-nested`): click picks the top-level child, double-click drills. Checklist wording: "Esc goes up a level".
- **Fix.** `select.escape`:
  - with a selected node that has a non-artboard parent, select the parent and remove it from `drilled`;
  - otherwise clear.
- **Verdict:** mismatch on Esc (clears instead of going up). Click and drill match.

### S3 Shift-click and marquee (`S3-shift-add.png`, `S3-shift-remove.png`, `S3-marquee.png`, `S3-marquee-result.png`, `S3-marquee-inside-frame.png`, `S3-marquee-inside-result.png`)

- **Verynize now.**
  - Shift-click toggles.
  - A marquee from empty canvas selects only **top-level** nodes it intersects. Across the artboard it selects `Portfolio Home Desktop`. The marquee is a 1px accent border with a 10 % fill.
  - Pressing on an artboard's background and dragging marquees its direct children (selected `About`, `Chip A–C`).
  - Hidden and locked layers are skipped.
- **Source.** `web/canvas-interactions.js:953-968`, `:521-524`; `web/canvas.css:29`.
- **Wonder** (`S3-marquee`, `S3-shift-add`): same model (artboard background starts a child marquee).
- **Fix.** None known. Compare marquee colour and fill when Codex's notes arrive.
- **Verdict:** match (behaviour).

### S4 Selection chrome (`S4-frame.png`, `S4-hug.png`, `S4-fill.png`, `S4-fixed.png`, `S4-multi-selection.png`)

- **Verynize now.**
  - **Ring and handles.** 1.5px accent ring and four 8×8 white corner handles with an accent border.
  - **Name label.** 18 px above (21 px offset), accent coloured when selected (`Portfolio Home Desktop`).
  - **Size badge.** 19 tall, radius 4, padding 3/7, 11px system-ui, bg rgb(181,54,218), 7 px below the box. Text varies by mode:
    - `1440 × 900`
    - `560 × 129 Hug` (H is Hug)
    - `280 Fill × 280`
    - `280 × 280`
  - **No `+` add-to-chat chip.**
  - **Multi-select.** No union bounding box. Each node gets its own ring, and the badge and name show the first selected node only (`400 × 56`, `About`).
- **Source.** `web/app.js:98` (`updateMeasurement`); `web/wonder-shell.css:6` (badge), `:15` (handles); `web/canvas.css:10-18`, `:34-35`.
- **Wonder** (user screenshot, `S4-frame-verified`, `TR8-*`):
  - Badge `1440 x 900` (ASCII x), ≈74×22, rgb≈(165,70,216), 11 px below.
  - Hug shows on both axes, e.g. `780 Hug x 391.17 Hug`.
  - A circular `+` chip sits at the top-right corner above the frame.
  - Multi-select shows one union box with a single badge (`K3-frame-selection` shows `739 x 391.18` after framing; `TR7-reorder-during` shows `2 nodes selected`).
- **Fix.**
  - Badge text: use `x` and per-axis `Hug`/`Fill` after each number, as Verynize already does. Set height 22, offset 11.
  - Add the `+` chip (`#selection-chat-chip`) at top-right that runs `Add context`.
  - For more than one node, draw a union ring and show a badge of the union size; hide per-node handles.
- **Verdict:** mismatch. No `+` chip, no multi-select union box, badge glyph and size differ.

## TR. Transform

### TR1 Resize (`TR1-corner.png`, `TR1-shift.png`, `TR1-alt.png`, `TR1-edge-hover.png`)

- **Verynize now.**
  - Corner drag on Chip C (+40/+18 screen) gives `233 × 116.4` live. The `nwse-resize` cursor shows.
  - Shift gives `233 × 124.3` (keeps 120:64).
  - Alt resizes from the centre (`290.9 × 152.2`) **and also triggers the Alt distance overlay**: 4 red guides labelled 1160, 160, 640 and 196 appear while resizing.
  - Edges have no handles. Hovering the edge midpoint leaves the default cursor, so only corners resize.
- **Source.** `web/canvas-interactions.js:915-951`; Alt overlay from keydown `:1475` (`measureTo`).
- **Wonder** (`TR1-corner`, `TR1-shift`, `TR1-alt`): corner handles and badge. Edge behaviour is to be confirmed in Codex's notes.
- **Fix.** Suppress `measureTo` while a resize or move gesture is active (`workspace.classList.contains('moving')` or a resize flag). Add invisible 6 px edge hit zones if Wonder resizes from edges.
- **Verdict:** close. Alt also shows distance guides; edge resize is missing.

### TR2 Rotate (`TR2-hover.png`, `TR2-rotate.png`)

- **Verynize now.** There is no rotate zone.
  - Hovering just outside the NE corner shows the default cursor and outlines the artboard.
  - Dragging from there starts an artboard-child marquee and deselects Chip C.
  - Rotation is only possible through the inspector `°` field and ⌥⇧R / ⌥⇧L (90°).
- **Source.** `web/canvas-interactions.js:505-536` (no rotate branch); `:1165` (`rotate90`).
- **Wonder** (`TR2-rotate-verified`, `TR2-test-frame`): dragging outside a corner rotates (frame at −47.19°). The badge rotates with the frame, and the inspector `∟` shows −47.19.
- **Fix.**
  - Add four 16 px rotate zones outside each corner, with a rotate cursor.
  - On drag, set `rotation = normalize(atan2 delta)` around the centre. Shift snaps to 15°.
  - Show the angle in the badge.
- **Verdict:** missing.

### TR3 Nudge (`TR3-nudge.png`, `TR3-shift-nudge.png`)

- **Verynize now.** → moves x 1160 → 1161; ⇧→ moves 1160 → 1171 (+1, then +10). Amounts come from the preferences `smallNudge` / `largeNudge`. Auto-layout children step through the stack instead.
- **Source.** `web/canvas-interactions.js:1476-1484` (amounts at `:1481`).
- **Wonder** (`TR3-nudge`, `TR3-shift-nudge`): 1 and 10.
- **Fix.** None.
- **Verdict:** match.

### TR4 Smart guides (`TR4-sibling.png` = edge alignment, `TR4-guide.png` = equal spacing)

- **Verynize now.**
  - Dragging Chip C shows 1px red-pink guides (`#ff3d7f`) for edge and centre alignment with siblings and the parent.
  - Equal-spacing snapping draws dashed segments with pink labels (`50`, `58` here).
  - Snap threshold is 6 screen px. ⌘ disables snapping, as does `Snap to objects` off.
- **Source.** `web/canvas-interactions.js:852-908`; `web/canvas.css:25-28`.
- **Wonder** (`TR4-guide`, `TR4-sibling`): guide lines between rotated and unrotated frames. Colour looks blue/purple in `TR4-guide`.
- **Fix.** Match the guide colour once Codex measures it (likely the accent or a blue, not pink).
- **Verdict:** close (behaviour present; colour likely differs).

### TR5 Alt distances (`TR5-alt-sibling.png`, `TR5-alt-parent.png`)

- **Verynize now.**
  - With Chip A selected and Alt over Chip B: one red line labelled `40`. The hovered layer is outlined.
  - Alt over the artboard background: only **one** segment is drawn (`568`, to the hovered `Site Header` area). The expected four parent distances are missing because the hovered element is the header, not the parent.
- **Source.** `web/canvas-interactions.js:1017-1036`.
- **Wonder** (`TR5-alt-parent`):
  - blue chips (`80`, `216`, `28`), dashed lines to the parent box and a dashed parent outline;
  - the labels sit in blue rounded chips.
- **Fix.**
  - Colour: blue chips and dashed lines for measurement, distinct from snap guides.
  - When the hovered node is the selection's ancestor (or empty space inside the parent), measure to the parent's four sides.
- **Verdict:** mismatch (colour, and the parent-distance case).

### TR6 Alt-drag duplicate (`TR6-alt-duplicate.png`, `TR6-alt-drag-result.png`)

- **Verynize now.** Alt-drag duplicates on the first move. The copy follows the pointer (y 640 → 805.4) and the original stays. No distance readout appears during the drag; the Alt overlay is suppressed while `moving`.
- **Source.** `web/canvas-interactions.js:708` (`duplicateNodes(moving, 0)`).
- **Wonder** (`TR6-alt-duplicate`): the duplicate is named `Frame 3`. Spec §2.4 says Alt-drag shows distances for the duplicate.
- **Fix.** Draw the TR5 distance overlay from the duplicate to the original during an Alt-drag. Name copies `<name> 2/3…`? Wonder renames frames as `Frame 2`, `Frame 3`; Verynize keeps the same name.
- **Verdict:** close. Duplicate works; no distances; naming differs.

### TR7 Into/out of frames and flex reorder (`TR7-drag-into-flex.png`, `TR7-drag-into-flex-result.png`, `TR7-reorder-during.png`, `TR7-reorder-after.png`, `TR7-out-during.png`)

- **Verynize now.**
  - **Into a flex frame.** Dragging Chip A over `Hero Section` outlines the target (1.5px accent) and shows a 2px slot bar between children. On drop it becomes a stack child.
  - **Reordering inside the stack** is live. The dragged copy is a translated ghost, and siblings reflow.
  - **Out to another artboard.** Dragging Chip B onto `MacBook Air` re-parents it as soon as the pointer crosses in, with guides to the new parent.
- **Source.** `web/canvas-interactions.js:702-850`.
- **Wonder** (`TR7-reorder-during`, `TR7-out-during`, `TR7-flex-fit`): live reorder. On drag-out, a translucent placeholder column marks the old slot.
- **Fix.** Compare the indicator styles. Wonder shows a tinted placeholder where the item left the stack.
- **Verdict:** close.

### TR8 Padding/gap handles (`TR8-flex.png`, `TR8-hover.png`, `TR8-gap-padding.png`)

- **Verynize now.** Bands are drawn only while the pointer is over the selected flex frame: 4 padding bands plus 2 gap bands (6 total).
  - **Padding bands:** blue `#3d8bff`, hatched on hover, `ns-resize` / `ew-resize` cursor.
  - **Gap bands:** orange `#f2541b`, hatched, with a 12×2 bar, `col-resize` / `row-resize` cursor.
  - A value badge appears on hover. Dragging edits the value live.
- **Source.** `web/canvas-interactions.js:112-244`; `web/canvas.css:40-56`.
- **Wonder** (`TR8-flex`, `TR8-hover`, `TR8-gap-padding`): small short tick handles on the padding edges and between children, with no hatching visible at rest. The badge shows `780 Hug x 391.17 Hug`.
- **Fix.** Compare colours and tick sizes. Wonder's handles look like short neutral ticks rather than coloured bands.
- **Verdict:** close (feature present; styling differs).

## V. View / camera

### V1 Zoom (`V1-in.png`, `V1-out.png`, `V1-100.png`, `V1-shift1-fit.png`, `V1-shift2-selection.png`, `V1-pinch-at-cursor.png`)

- **Verynize now.**
  - Stops are 5, 10, 25, 50, 100, 200, 400, 800, 1600 and 3200 %.
  - From the 36 % fit: ⌘+ goes to 50 %. ⌘− twice goes to 25 → 10 %.
  - ⇧0 goes to 100 % centred. ⇧1 fits (36 %). ⇧2 zooms to the selection (245 % for Hero Media).
  - Ctrl+wheel (pinch) zooms around the cursor: 4 small deltas took it to 60 %.
  - Zooming is instant, with no animation.
- **Source.** `web/canvas-interactions.js:6` (stops), `:275-311`, `:319-331`.
- **Wonder.** Spec §2.6 stops end at 6400, 12800 and 20000 %, and zoom animates (`V1-in`, `V1-out`, `V1-100`, `V1-reset`).
- **Fix.**
  - Extend `ZOOM_STOPS` with 64, 128 and 200 and raise `MAX_ZOOM`.
  - Animate `setCamera` over about 150 ms for step, fit and selection zoom (not wheel).
- **Verdict:** close. Max zoom 3200 % versus 20000 %; no animation.

### V2 Pan (`V2-space-hold.png`, `V2-space-drag.png`, `V2-hand.png`)

- **Verynize now.** Holding Space shows the `grab` cursor; dragging pans with `grabbing`. The Hand tool pans the same way.
- **Source.** `web/canvas-interactions.js:500-504`, `:1474` (Space).
- **Wonder** (`V2-hand`): same.
- **Verdict:** match.

### V3 Fit / selection (`V3-fit.png`, `V3-selection.png`)

- **Verynize now.** ⇧1 fits both artboards (36 %) with safe insets of 48/40/96/40. ⇧2 on Chip A gives 665 %.
- **Source.** `web/canvas-interactions.js:8`, `:298-311`.
- **Wonder** (`V3-fit`, `V3-selection`): same commands. The padding has not been measured yet.
- **Verdict:** match (behaviour). Padding is to be compared.

### V4 High zoom (`V4-high-zoom.png`)

- **Verynize now.** At 3200 % (the maximum) there are no rulers and no pixel grid. Chip A's corner is pixel-smooth CSS.
- **Source.** No grid code exists.
- **Wonder** (`V4-high-zoom`, 548 %): no rulers or grid visible. The spec says none.
- **Verdict:** match. Neither has a grid; Wonder goes higher.

## K. Keyboard and clipboard

### K1 Shortcuts panel (`K1-shortcuts.png`, `K1-command-palette.png`)

- **Verynize now.**
  - The only shortcut list is the `?` popover from T5 (19 rows, no search, no sections).
  - ⌘K opens the **Files** screen (file search), not a command palette.
  - The command registry (`commands()`) exists but has no UI.
- **Source.** `CanvasOverlays.tsx:321-381`; `web/canvas-interactions.js:1393-1457`, `:1618` (`commands`).
- **Wonder** (`K1-page-01…09`, `K1-scroll-*`, `K1-shortcuts`):
  - **Panel layout.** A right-side `Keyboard shortcuts` panel with `Search shortcuts…`, a pinned `Command palette ⌘K` row and sections: APPLICATION, TOOLS, EDIT, …
  - **Rows seen** include `Command palette ⌘K`, `Go to settings ⌘,`, `Move tool V`, `Scale tool K`, `Hand tool H`, `Temporary hand tool Space`, `Frame tool F`, `Text tool T`, `Shader tool S`, `Eye dropper I`, `Eye dropper (alt) ⌃C`, `Copy ⌘C`, `Copy as code ⌘⇧C`, `Copy styles ⌘⌥C`, `Copy prompt ⌘⇧⌥C`, `Paste ⌘V`, `Paste styles ⌘⌥V`, `Paste to replace ⌘⇧R` …
  - ⌘K is the command palette.
- **Fix.**
  - Build the panel from `commands()` grouped by `section`, with a search field, rendered in the right panel.
  - Bind ⌘K to a command palette over the same registry; move file search to another key (or into the palette).
- **Verdict:** mismatch.

### K2 Clipboard (`K2-paste.png`, `K2-duplicate.png`, `K2-over.png`, `K2-replace.png`, `K2-paste-here.png`)

- **Verynize now.**
  - **⌘C ⌘V** with Chip A visible pastes a copy at the same x/y (760, 640) in the same parent. It is centred in the view only when the original is off-screen.
  - **⌘D** offsets the duplicate by +20/+20 (780, 660).
  - **⌘⇧V** is `Paste in place`: a copy at 760, 640 even though Chip C was selected. It does **not** paste over or into the selection.
  - **⌘⇧R** (Paste to replace) does **nothing**: no command is bound and the node list is unchanged.
  - **"Paste here"** via the context menu's `Paste` pastes at the original position, **not at the cursor**.
  - `Copy as ›` has no submenu (CM2). There is `Copy as PNG` / `Copy as code` / `Copy style`, and no `Copy prompt` or `Copy link to selection`.
- **Source.** `web/canvas-interactions.js:1274-1390` (clipboard; `paste` `:1328`), `:1408-1416` (commands; `edit.pasteInPlace` ⌘⇧V at `:1411`), `:1051` (`duplicateNodes`, offset 20).
- **Wonder** (`K2-paste`, `K2-duplicate`, `K2-over`, `K2-replace`, `K2-paste-here-menu`, `K2-paste-here`):
  - `Paste to replace ⌘⇧R` replaces the selection.
  - `Paste over selection ⌘⇧V` pastes on top of the selection.
  - `Paste here` pastes at the right-click point.
- **Fix.** Add these commands:
  - `edit.pasteReplace` (⌘⇧R): paste each root at the selected node's position and parent, then delete the replaced nodes, in one undo step.
  - `edit.pasteOver` (⌘⇧V): paste centred on the selection's bounds in its parent.
  - `edit.pasteHere`: paste at the context-menu world point.

  Also:
  - Remap `Paste in place` off ⌘⇧V.
  - Add `copyPrompt` (⌘⇧⌥C) and `copyLink`.
  - Check Wonder's ⌘D offset in Codex's notes.

- **Verdict:** mismatch. Paste to replace, paste over and paste here are missing; ⌘⇧V means something else.

### K3 Structure keys (`K3-frame-selection.png`, `K3-unframe.png`, `K3-hide.png`, `K3-lock.png`, `K3-delete.png`)

- **Verynize now.**
  - ⌘G on Chip A and Chip B wraps them in a new free `Frame` at their union (280×64), selected.
  - ⌘⇧G unwraps and reselects both.
  - ⌘⇧H hides Chip A: the canvas box is gone and the layer row is dimmed with an eye-off icon.
  - ⌘⇧L locks: a lock icon shows in the row, and the selection stays with no handles.
  - ⌫ deletes.
- **Source.** `web/canvas-interactions.js:1059-1094`, `:1141`, `:1431-1447`.
- **Wonder** (`K3-frame-selection`, `K3-unframe`): ⌘G wraps into `Frame` (739 x 391.18 badge), and ⌘⇧G unwraps.
- **Verdict:** match (behaviour).

## TX. Text on canvas

### TX1 Text tool (`TX1-click.png`, `TX1-selection.png`, `TX1-escape.png`, `TX1-drag.png`, `TX1-drag-result.png`)

- **Verynize now.**
  - **Click.** A 240×60 box, content `Your next idea` (all selected), system-ui 24px, ink and caret rgb(37,37,46).
  - **Drag.** A rubber band, then a box of the dragged size (360×63) with the same content.
  - **Editing.** Typing replaced the content; ⇧← ⇧← selected `lo` with the native selection colour. Esc commits and leaves the layer selected.
- **Source.** `web/canvas-interactions.js:638-690` (editor), `:981-1015` (draw); `web/app.js:22` (defaults).
- **Wonder** (`TX1-click`, `TX1-drag`, `TX1-selection`):
  - Click creates an **empty** text with a blinking caret, **Inter 12, black, W/H Hug** (inspector `0 Hug × 14.5 Hug`).
  - Drag creates a 150×60 fixed box.
  - Selection highlight in the text is visible in `TX1-selection`.
- **Fix.**
  - Text tool click: `{text: '', fontFamily: 'Inter', fontSize: 12, color: default ink, wMode: 'hug', hMode: 'hug'}`.
  - Drag: fixed W/H with an empty text.
  - Remove the empty text on Esc or blur.
  - Use the accent-tinted selection colour if Codex measures one.
- **Verdict:** mismatch (default content, font, size and sizing mode).

## L. Layers and pages panels

### L1 Layer rows (`L1-hover.png`, `L1-rename.png`, `L1-reorder-during.png`, `L1-expand-collapse.png`)

- **Verynize now.**
  - **Rows.** 30 tall (`h-7.5`), radius 6.
  - **Hover.** Reveals three 24 px buttons: Rename (T icon), Lock, Eye. Locked and hidden rows keep their icon visible. Hovering a row outlines the layer on the canvas.
  - **Rename.** Double-click (or F2) renames inline with all text selected.
  - **Reorder.** Dragging a row shows a drop indicator and dims the dragged row to 50 %.
  - **Collapse.** The chevron collapses and expands.
- **Source.** `web/src/islands/sidebar/LayersSection.tsx:100-264`; `web/src/islands/sidebar/layer-drag.ts`.
- **Wonder** (`L1-hover`, `L1-rename`, `L1-reorder-during`):
  - The same three icons (T, lock, eye) on hover, with a `Lock layer` tooltip.
  - Rename is inline.
  - Reorder is supported.
- **Fix.** Add the `Lock layer` / `Hide layer` / `Rename layer` tooltip text (Verynize uses `title="Lock"`, a native tooltip).
- **Verdict:** close (tooltip strings differ).

### L2 Pages (`L2-add.png`, `L2-rename.png`, `L2-page-delete.png`, `L2-reorder-during.png`)

- **Verynize now.**
  - `+` adds `Page 3` and activates it.
  - Double-click opens a modal `Page name` dialog (input, `Cancel` / `Continue`) instead of an inline field.
  - `Delete page` removes the page **immediately, with no confirmation** (undoable).
  - Pages **cannot be reordered**: dragging `Page 1` does nothing.
- **Source.** `web/app.js:33` (`#add-page`, `#rename-page` → `askText`, `#delete-page`); `web/src/islands/sidebar/PagesSection.tsx:24-58`.
- **Wonder** (`L2-add`, `L2-rename-menu`, `L2-rename-field`, `L2-renamed`, `L2-reorder-during`, `L2-order-confirmed`):
  - Rename is inline in the row.
  - Pages reorder by drag (a magnifier-style drag ghost is visible).
  - Delete confirmation is to be confirmed in Codex's notes.
- **Fix.**
  - Rename inline, reusing `InlineRename` from LayersSection.
  - Add pointer drag-reorder to page rows: reorder `design.pages` in one undo step.
  - Add a confirm step if Wonder has one.
- **Verdict:** mismatch (modal rename, no reorder).

---

## Could not capture / not observable

- **Wonder submenus on Verynize (`CM2-copy-as/select-layer/arrange/layout`).** Verynize has no submenus. The shots hover the nearest flat item.
- **TR2 rotate.** Not observable in Verynize; there is no rotate interaction.
- **K2 Paste to replace / Paste here at cursor.** Not observable; the commands do not exist. The shots show the unchanged result.
- **K1 command palette.** ⌘K opens Files (shot `K1-command-palette.png`).
- **L2 page reorder.** No drag support. `L2-reorder-during.png` shows nothing moving.
- **S2 ⌘-click deep select** selected the parent in the automated run. Not confirmed manually.
- **CM10 disabled styling** cannot be compared: Verynize never renders disabled canvas-menu items, and I could not confirm Wonder's disabled tint from the PNGs.
